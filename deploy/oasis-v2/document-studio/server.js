import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';

const port = Number.parseInt(process.env.PORT ?? '3012', 10);
const workspaceRoot = path.resolve(process.env.OASIS_DOCUMENT_WORKSPACE ?? '/workspace');
const templatePath = '/app/templates/oasis-reference.docx';
const taxonomy = JSON.parse(await readFile('/app/taxonomy.json', 'utf8'));

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function workspacePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new Error('Un chemin relatif à l’espace de travail est requis.');
  const target = path.resolve(workspaceRoot, relativePath);
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('Le chemin doit rester dans l’espace de travail OASIS.');
  return target;
}

async function ensureReadable(relativePath) {
  const absolutePath = workspacePath(relativePath);
  await access(absolutePath);
  return absolutePath;
}

async function ensureOutputDirectory(relativePath) {
  const absolutePath = workspacePath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

function run(command, args, { cwd = workspaceRoot, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => process.kill('SIGKILL'), timeoutMs);
    process.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    process.on('error', (error) => { clearTimeout(timer); reject(error); });
    process.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} a échoué (code=${code}, signal=${signal ?? 'n/a'}): ${(stderr || stdout).slice(0, 3000)}`));
    });
  });
}

function withoutExtension(relativePath) {
  return relativePath.slice(0, relativePath.lastIndexOf('.'));
}

async function renderMarkdown(sourceMarkdownPath, outputBasePath, outputFormats, title, author) {
  if (!sourceMarkdownPath.toLowerCase().endsWith('.md')) throw new Error('La source doit être un fichier Markdown (.md).');
  const source = await ensureReadable(sourceMarkdownPath);
  const outputBase = workspacePath(outputBasePath);
  await mkdir(path.dirname(outputBase), { recursive: true });

  const outputs = [];
  const docxPath = `${outputBase}.docx`;
  const needsDocx = outputFormats.includes('docx') || outputFormats.includes('pdf');
  if (needsDocx) {
    const args = [source, '-o', docxPath, '--reference-doc', templatePath, '--toc', '--number-sections', '--metadata', `title=${title}`, '--metadata', `author=${author}`];
    await run('pandoc', args);
    outputs.push(path.relative(workspaceRoot, docxPath));
  }
  if (outputFormats.includes('pdf')) {
    const pdfDirectory = path.dirname(outputBase);
    await run('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfDirectory, docxPath]);
    outputs.push(path.relative(workspaceRoot, `${outputBase}.pdf`));
  }
  return { source_markdown_path: sourceMarkdownPath, outputs, template: 'oasis-reference.docx', note: 'Le contenu est resté local. Le modèle de langage ne rédige que le Markdown; Pandoc et LibreOffice réalisent le rendu local.' };
}

async function renderPreview(inputPath, outputPngPath) {
  const input = await ensureReadable(inputPath);
  const output = await ensureOutputDirectory(outputPngPath);
  let pdfPath = input;
  let temporaryPdf = null;
  if (input.toLowerCase().endsWith('.docx')) {
    const tempDirectory = path.join(path.dirname(input), '.document-studio-preview');
    await mkdir(tempDirectory, { recursive: true });
    await run('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tempDirectory, input]);
    temporaryPdf = path.join(tempDirectory, `${path.basename(input, '.docx')}.pdf`);
    pdfPath = temporaryPdf;
  }
  if (!pdfPath.toLowerCase().endsWith('.pdf')) throw new Error('Le rendu visuel exige un fichier .docx ou .pdf.');
  const outputBase = output.replace(/\.png$/i, '');
  await run('pdftoppm', ['-png', '-f', '1', '-singlefile', '-r', '144', pdfPath, outputBase]);
  const metadata = await run('pdfinfo', [pdfPath]);
  return { input_path: inputPath, preview_png_path: outputPngPath, pdf_info: metadata.stdout, temporary_pdf: temporaryPdf ? path.relative(workspaceRoot, temporaryPdf) : null };
}

async function qcDocument(inputPath) {
  const input = await ensureReadable(inputPath);
  let pdfPath = input;
  let convertedPdf = null;
  if (input.toLowerCase().endsWith('.docx')) {
    const tempDirectory = path.join(path.dirname(input), '.document-studio-qc');
    await mkdir(tempDirectory, { recursive: true });
    await run('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tempDirectory, input]);
    convertedPdf = path.join(tempDirectory, `${path.basename(input, '.docx')}.pdf`);
    pdfPath = convertedPdf;
  }
  if (!pdfPath.toLowerCase().endsWith('.pdf')) throw new Error('Le contrôle qualité exige un fichier .docx ou .pdf.');
  const [info, text, fonts] = await Promise.all([
    run('pdfinfo', [pdfPath]),
    run('pdftotext', [pdfPath, '-']),
    run('pdffonts', [pdfPath]),
  ]);
  const pageMatch = info.stdout.match(/^Pages:\s+(\d+)/m);
  const pages = Number.parseInt(pageMatch?.[1] ?? '0', 10);
  const extractedCharacters = text.stdout.replace(/\s+/g, ' ').trim().length;
  const warnings = [];
  if (pages === 0) warnings.push('Aucune page PDF détectée.');
  if (extractedCharacters < 80) warnings.push('Très peu de texte extractible; vérifier si le document est vide ou composé essentiellement d’images.');
  if (!fonts.stdout.split('\n').slice(2).some((line) => line.trim())) warnings.push('Aucune police intégrée ou signalée; inspecter visuellement la fidélité typographique.');
  return {
    input_path: inputPath,
    checked_pdf_path: path.relative(workspaceRoot, pdfPath),
    pages,
    extracted_text_characters: extractedCharacters,
    fonts: fonts.stdout.trim().split('\n').slice(0, 20),
    warnings,
    status: warnings.length === 0 ? 'pass' : 'review_required',
    rule: 'Un résultat pass confirme un rendu exploitable, mais ne remplace pas la revue visuelle de la page titre, des tableaux et des pages contenant des images.',
  };
}

function allowedFolders(category) {
  const definition = taxonomy.categories?.[category];
  if (!definition) throw new Error(`Catégorie inconnue : ${category}`);
  return definition.folders;
}

async function classifyDocument(inputPath, category, targetFolder, destinationName) {
  const source = await ensureReadable(inputPath);
  if (!allowedFolders(category).includes(targetFolder)) {
    throw new Error(`Le dossier ${targetFolder} n’est pas autorisé pour la catégorie ${category}.`);
  }
  const safeName = destinationName ?? path.basename(source);
  if (safeName !== path.basename(safeName) || safeName.length < 1) {
    throw new Error('Le nom de destination doit être un simple nom de fichier, sans chemin.');
  }
  const destinationRelativePath = path.posix.join(targetFolder, safeName);
  const destination = workspacePath(destinationRelativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await access(destination);
    throw new Error(`Le fichier de destination existe déjà : ${destinationRelativePath}`);
  } catch (error) {
    if (!String(error).includes('ENOENT')) {
      if (String(error).includes('existe déjà')) throw error;
    }
  }
  await rename(source, destination);
  return { input_path: inputPath, category, destination_path: destinationRelativePath, status: 'classified', note: 'Consigner ce classement dans la mémoire partagée avec les références de source et le statut du document.' };
}

function createServer() {
  const server = new McpServer({ name: 'oasis-document-studio', version: '0.1.0' });

  server.registerTool(
    'get_document_taxonomy',
    {
      description: 'Afficher la taxonomie documentaire OASIS et les dossiers autorisés avant de classer une source, une pièce de preuve ou un livrable.',
      inputSchema: {},
    },
    async () => textResult(taxonomy),
  );

  server.registerTool(
    'classify_workspace_document',
    {
      description: 'Déplacer un fichier local vers un dossier explicitement autorisé par la taxonomie OASIS. Refuse un écrasement et retourne le chemin final à enregistrer dans la mémoire commune.',
      inputSchema: {
        input_document_path: z.string().min(5).max(500),
        category: z.enum(['source', 'finance', 'schedule', 'pse_sig', 'governance', 'reporting', 'deliverable', 'archive']),
        target_folder: z.string().min(4).max(300),
        destination_name: z.string().min(1).max(180).optional(),
      },
    },
    async ({ input_document_path, category, target_folder, destination_name }) => textResult(await classifyDocument(input_document_path, category, target_folder, destination_name)),
  );

  server.registerTool(
    'create_document_brief',
    {
      description: 'Créer un manifeste éditorial local en Markdown avant la rédaction : public, but, sources, structure, ton, livrables et vérifications. Utiliser avant les rapports importants.',
      inputSchema: {
        output_markdown_path: z.string().min(8).max(500).default('07_livrables/01_brouillons/brief_document.md'),
        title: z.string().min(3).max(250),
        audience: z.string().min(3).max(400),
        objective: z.string().min(10).max(2000),
        required_sections: z.array(z.string().min(2).max(200)).min(1).max(30),
        source_references: z.array(z.string().min(2).max(500)).max(50).default([]),
        output_formats: z.array(z.enum(['docx', 'pdf'])).min(1).max(2).default(['docx', 'pdf']),
      },
    },
    async ({ output_markdown_path, title, audience, objective, required_sections, source_references, output_formats }) => {
      const output = await ensureOutputDirectory(output_markdown_path);
      const content = [
        `# Brief documentaire — ${title}`,
        '',
        `**Public :** ${audience}`,
        '',
        `**Objectif :** ${objective}`,
        '',
        `**Formats prévus :** ${output_formats.join(', ')}`,
        '',
        '## Structure requise',
        ...required_sections.map((section, index) => `${index + 1}. ${section}`),
        '',
        '## Sources à citer ou vérifier',
        ...(source_references.length ? source_references.map((source) => `- ${source}`) : ['- À compléter']),
        '',
        '## Contrôle de sortie',
        '- Vérifier la cohérence des montants, dates, résultats et références avec les sources.',
        '- Rendre le brouillon au format DOCX et/ou PDF avec la charte OASIS.',
        '- Générer un aperçu PNG et exécuter le contrôle qualité avant soumission.',
      ].join('\n');
      await writeFile(output, content, 'utf8');
      return textResult({ output_markdown_path, next_step: 'Rédiger le document Markdown complet en suivant ce brief, puis appeler render_markdown_document.' });
    },
  );

  server.registerTool(
    'render_markdown_document',
    {
      description: 'Rendre un brouillon Markdown local en document DOCX et/ou PDF professionnel avec la charte OASIS, table des matières et numérotation des sections.',
      inputSchema: {
        source_markdown_path: z.string().min(5).max(500),
        output_base_path: z.string().min(5).max(500).default('07_livrables/01_brouillons/document'),
        output_formats: z.array(z.enum(['docx', 'pdf'])).min(1).max(2).default(['docx', 'pdf']),
        title: z.string().min(3).max(250),
        author: z.string().min(2).max(200).default('Ville de Val-d’Or'),
      },
    },
    async ({ source_markdown_path, output_base_path, output_formats, title, author }) => textResult(await renderMarkdown(source_markdown_path, output_base_path, output_formats, title, author)),
  );

  server.registerTool(
    'render_document_preview',
    {
      description: 'Convertir la première page d’un DOCX ou PDF local en PNG pour une revue visuelle rapide. À utiliser après chaque production importante.',
      inputSchema: {
        input_document_path: z.string().min(5).max(500),
        output_preview_png_path: z.string().min(8).max(500).default('07_livrables/02_revue_qualite/document_page_1.png'),
      },
    },
    async ({ input_document_path, output_preview_png_path }) => textResult(await renderPreview(input_document_path, output_preview_png_path)),
  );

  server.registerTool(
    'check_document_quality',
    {
      description: 'Exécuter des contrôles déterministes sur un DOCX ou PDF local : pages, texte extractible, polices et avertissements. Compléter par une revue visuelle des pages sensibles.',
      inputSchema: { input_document_path: z.string().min(5).max(500) },
    },
    async ({ input_document_path }) => textResult(await qcDocument(input_document_path)),
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
      transport.close().catch((error) => console.error('Document MCP transport close failed', error));
      server.close().catch((error) => console.error('Document MCP server close failed', error));
    });
  } catch (error) {
    console.error('Document MCP request failed', error);
    if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur documentaire interne' }, id: null });
  }
});
app.get('/health', (_request, response) => response.status(200).json({ status: 'ok', capabilities: ['get_document_taxonomy', 'classify_workspace_document', 'create_document_brief', 'render_markdown_document', 'render_document_preview', 'check_document_quality'] }));
app.listen(port, () => console.log(`OASIS document studio MCP listening on port ${port}`));
