import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { XMLParser } from 'fast-xml-parser';
import * as turf from '@turf/turf';
import * as z from 'zod/v4';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number.parseInt(process.env.PORT ?? '3011', 10);
const workspaceRoot = path.resolve(process.env.OASIS_GIS_WORKSPACE ?? '/workspace');
// Les agents voient le volume partagé sous /data, tandis que ce service le
// monte sous /workspace. Ce préfixe client est remappé strictement vers le
// même volume et ne permet jamais d'accéder à un chemin hôte arbitraire.
const agentWorkspaceRoot = path.resolve(
  process.env.OASIS_GIS_AGENT_WORKSPACE ?? '/data/shared-workspace',
);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ['Placemark', 'Polygon', 'LineString', 'Point', 'MultiGeometry', 'coordinates', 'outerBoundaryIs', 'innerBoundaryIs', 'LinearRing'].includes(name),
});

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function asArray(value) {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function workspacePath(requestedPath) {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('Un chemin relatif à l’espace de travail est requis.');
  }

  let relativePath = requestedPath.trim();
  if (path.isAbsolute(relativePath)) {
    const absoluteInput = path.resolve(relativePath);
    const inputRoot = [workspaceRoot, agentWorkspaceRoot].find((root) => (
      absoluteInput === root || absoluteInput.startsWith(`${root}${path.sep}`)
    ));
    if (!inputRoot) {
      throw new Error('Le chemin doit rester dans l’espace de travail OASIS.');
    }
    relativePath = path.relative(inputRoot, absoluteInput);
  }

  const target = path.resolve(workspaceRoot, relativePath);
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error('Le chemin doit rester dans l’espace de travail OASIS.');
  }
  return target;
}

async function readKml(relativePath) {
  if (!relativePath.toLowerCase().endsWith('.kml')) {
    throw new Error('Le fichier d’entrée doit être au format .kml.');
  }
  const absolutePath = workspacePath(relativePath);
  const xml = await readFile(absolutePath, 'utf8');
  const document = parser.parse(xml);
  return { document, absolutePath };
}

function findValues(node, targetKey, found = []) {
  if (Array.isArray(node)) {
    for (const value of node) findValues(value, targetKey, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === targetKey) found.push(...asArray(value));
    findValues(value, targetKey, found);
  }
  return found;
}

function plainText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value['#text'] ?? value.__cdata ?? '');
}

function parseCoordinates(value) {
  const text = plainText(value).trim();
  if (!text) return [];
  return text.split(/\s+/).map((entry) => {
    const [longitude, latitude, altitude] = entry.split(',').map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new Error(`Coordonnée KML invalide : ${entry}`);
    }
    return Number.isFinite(altitude) ? [longitude, latitude, altitude] : [longitude, latitude];
  });
}

function closeRing(coordinates) {
  if (coordinates.length < 3) throw new Error('Un polygone KML exige au moins trois sommets.');
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) return [...coordinates, first];
  return coordinates;
}

function polygonFeature(polygon, properties) {
  const outer = asArray(polygon.outerBoundaryIs)[0];
  const outerRing = asArray(outer?.LinearRing)[0];
  const outerCoordinates = parseCoordinates(asArray(outerRing?.coordinates)[0]);
  const holes = asArray(polygon.innerBoundaryIs).map((boundary) => {
    const ring = asArray(boundary?.LinearRing)[0];
    return closeRing(parseCoordinates(asArray(ring?.coordinates)[0]));
  }).filter((ring) => ring.length >= 4);
  return turf.polygon([closeRing(outerCoordinates), ...holes], properties);
}

function lineFeature(line, properties) {
  const coordinates = parseCoordinates(asArray(line.coordinates)[0]);
  if (coordinates.length < 2) throw new Error('Une ligne KML exige au moins deux sommets.');
  return turf.lineString(coordinates, properties);
}

function pointFeature(point, properties) {
  const coordinates = parseCoordinates(asArray(point.coordinates)[0]);
  if (coordinates.length === 0) throw new Error('Un point KML exige une coordonnée.');
  return turf.point(coordinates[0], properties);
}

function geometriesFromNode(node, properties, output = []) {
  for (const polygon of asArray(node?.Polygon)) output.push(polygonFeature(polygon, properties));
  for (const line of asArray(node?.LineString)) output.push(lineFeature(line, properties));
  for (const point of asArray(node?.Point)) output.push(pointFeature(point, properties));
  for (const multiGeometry of asArray(node?.MultiGeometry)) geometriesFromNode(multiGeometry, properties, output);
  return output;
}

function extractKmlFeatures(parsed) {
  const placemarks = findValues(parsed, 'Placemark');
  const features = [];
  placemarks.forEach((placemark, index) => {
    const properties = {
      source_index: index + 1,
      name: plainText(placemark?.name) || `Placemark ${index + 1}`,
      description: plainText(placemark?.description),
      style_url: plainText(placemark?.styleUrl),
    };
    try {
      features.push(...geometriesFromNode(placemark, properties));
    } catch (error) {
      features.push(turf.point([0, 0], { ...properties, parse_error: String(error), invalid_geometry: true }));
    }
  });
  return features;
}

function featureMeasurement(feature) {
  const geometryType = feature.geometry?.type;
  if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
    return { area_m2: turf.area(feature), length_m: null, centroid: turf.centroid(feature).geometry.coordinates };
  }
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    return { area_m2: null, length_m: turf.length(feature, { units: 'kilometers' }) * 1000, centroid: turf.center(feature).geometry.coordinates };
  }
  return { area_m2: null, length_m: null, centroid: feature.geometry?.coordinates ?? null };
}

function normalizeProjectCode(feature, index) {
  const props = feature.properties ?? {};
  const raw = String(props.project_id ?? props.code ?? props.id ?? props.name ?? `P${index + 1}`).trim();
  return raw.toUpperCase().replace(/\s+/g, '_').slice(0, 80);
}

async function readProjectBoundaries(relativePath) {
  if (!relativePath.toLowerCase().endsWith('.geojson') && !relativePath.toLowerCase().endsWith('.json')) {
    throw new Error('Les emprises de projet doivent être un GeoJSON (.geojson ou .json).');
  }
  const absolutePath = workspacePath(relativePath);
  const collection = JSON.parse(await readFile(absolutePath, 'utf8'));
  const candidates = collection.type === 'FeatureCollection' ? collection.features : [collection];
  const boundaries = candidates.filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type));
  if (boundaries.length === 0) throw new Error('Aucune emprise polygonale valide n’a été trouvée.');
  return boundaries.map((feature, index) => ({ code: normalizeProjectCode(feature, index), feature }));
}

async function writeGeoJson(relativePath, featureCollection) {
  const absolutePath = workspacePath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(featureCollection, null, 2));
  return relativePath;
}

function createServer() {
  const server = new McpServer({ name: 'oasis-gis-local', version: '0.1.0' });

  server.registerTool(
    'inspect_kml',
    {
      description: 'Inventorier localement un KML : géométries, noms, erreurs de lecture et métriques géodésiques. Les superficies sont calculées sur WGS84 en m²; ne pas les présenter comme finales sans emprises P1/P2/P3 validées.',
      inputSchema: { kml_path: z.string().min(5).max(500) },
    },
    async ({ kml_path }) => {
      const { document } = await readKml(kml_path);
      const features = extractKmlFeatures(document);
      const summary = { Polygon: 0, LineString: 0, Point: 0, invalid: 0, total_area_m2: 0, total_length_m: 0 };
      const named = [];
      for (const feature of features) {
        const type = feature.geometry?.type;
        if (feature.properties?.invalid_geometry) summary.invalid += 1;
        if (type in summary) summary[type] += 1;
        const metrics = featureMeasurement(feature);
        summary.total_area_m2 += metrics.area_m2 ?? 0;
        summary.total_length_m += metrics.length_m ?? 0;
        if (named.length < 200) named.push({ name: feature.properties?.name, geometry_type: type, ...metrics, parse_error: feature.properties?.parse_error ?? null });
      }
      return textResult({ kml_path, coordinate_reference_system: 'WGS84 (KML standard)', summary, named_features: named, note: 'Les totaux bruts incluent les hachures, symboles et géométries de conception. Utiliser project_surface_analysis avec des emprises projet validées pour les résultats PSE.' });
    },
  );

  server.registerTool(
    'export_kml_geojson',
    {
      description: 'Convertir un KML local en GeoJSON avec les attributs de placemark et les métriques de superficie/longueur. Le fichier de sortie est créé dans le workspace OASIS.',
      inputSchema: {
        kml_path: z.string().min(5).max(500),
        output_geojson_path: z.string().min(8).max(500).default('livrables/sig/kml_converti.geojson'),
      },
    },
    async ({ kml_path, output_geojson_path }) => {
      const { document } = await readKml(kml_path);
      const features = extractKmlFeatures(document).filter((feature) => !feature.properties?.invalid_geometry).map((feature) => ({
        ...feature,
        properties: { ...feature.properties, ...featureMeasurement(feature) },
      }));
      const output = await writeGeoJson(output_geojson_path, turf.featureCollection(features));
      return textResult({ kml_path, output_geojson_path: output, feature_count: features.length, coordinate_reference_system: 'WGS84' });
    },
  );

  server.registerTool(
    'project_surface_analysis',
    {
      description: 'Calculer les superficies d’objets KML par emprise projet GeoJSON. Le GeoJSON doit contenir les polygones P1/P2/P3, avec properties.project_id, code ou name. Les intersections sont géodésiques; classer et valider les objets avant une transmission officielle.',
      inputSchema: {
        kml_path: z.string().min(5).max(500),
        project_boundaries_geojson_path: z.string().min(8).max(500),
        output_geojson_path: z.string().min(8).max(500).default('livrables/sig/analyse_emprises_oasis.geojson'),
      },
    },
    async ({ kml_path, project_boundaries_geojson_path, output_geojson_path }) => {
      const { document } = await readKml(kml_path);
      const boundaries = await readProjectBoundaries(project_boundaries_geojson_path);
      const kmlPolygons = extractKmlFeatures(document).filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) && !feature.properties?.invalid_geometry);
      const results = boundaries.map(({ code }) => ({ project_code: code, intersected_object_count: 0, raw_intersection_area_m2: 0, object_contributions: [] }));
      const outputFeatures = [];
      const failures = [];

      for (const polygon of kmlPolygons) {
        for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
          const { code, feature: boundary } = boundaries[boundaryIndex];
          try {
            const intersection = turf.intersect(turf.featureCollection([polygon, boundary]));
            if (!intersection) continue;
            const areaM2 = turf.area(intersection);
            if (areaM2 <= 0) continue;
            const result = results[boundaryIndex];
            result.intersected_object_count += 1;
            result.raw_intersection_area_m2 += areaM2;
            if (result.object_contributions.length < 500) {
              result.object_contributions.push({ source_index: polygon.properties?.source_index, name: polygon.properties?.name, area_m2: areaM2, description: polygon.properties?.description ?? '' });
            }
            outputFeatures.push(turf.feature(intersection.geometry, { project_code: code, source_index: polygon.properties?.source_index, source_name: polygon.properties?.name, intersection_area_m2: areaM2 }));
          } catch (error) {
            if (failures.length < 100) failures.push({ project_code: code, source_index: polygon.properties?.source_index, name: polygon.properties?.name, error: String(error) });
          }
        }
      }
      const output = await writeGeoJson(output_geojson_path, turf.featureCollection(outputFeatures));
      return textResult({
        kml_path,
        project_boundaries_geojson_path,
        output_geojson_path: output,
        coordinate_reference_system: 'WGS84 geodesic area',
        results: results.map((result) => ({ ...result, raw_intersection_area_ha: result.raw_intersection_area_m2 / 10_000 })),
        failures,
        important_limit: 'Cette somme est une superficie d’intersections brutes et peut compter des hachures, objets superposés ou objets de conception. L’agent doit classifier, dissoudre par type et faire une validation SIG humaine avant de déclarer une superficie PSE finale.',
      });
    },
  );

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });
app.post('/mcp', async (request, response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on('close', () => {
      transport.close().catch((error) => console.error('SIG MCP transport close failed', error));
      server.close().catch((error) => console.error('SIG MCP server close failed', error));
    });
  } catch (error) {
    console.error('SIG MCP request failed', error);
    if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur SIG interne' }, id: null });
  }
});
app.get('/health', (_request, response) => response.status(200).json({
  status: 'ok',
  workspace: workspaceRoot,
  accepted_agent_workspace: agentWorkspaceRoot,
  capabilities: ['inspect_kml', 'export_kml_geojson', 'project_surface_analysis'],
}));
app.listen(port, () => console.log(`OASIS GIS MCP listening on port ${port}`));
