#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const N8N_URL = 'http://n8n:5678';
const WORKFLOWS_DIR = String(
  process.env.AGENTS_LOCAL_WORKFLOWS_DIR || '/workspace/agents/n8n/workflows',
).trim();
const MCP_HUB_WORKFLOWS_DIR = String(
  process.env.MCP_HUB_LOCAL_WORKFLOWS_DIR || '/workspace/agents/mcp-hub/workflows',
).trim();
const MARKER_FILE = '/home/node/.n8n/.govchat-seeded-v8';
const JEMS_CREDENTIAL_ID = '00000000-0000-4000-8000-000000000222';
const JEMS_CREDENTIAL_NAME = 'JEMS MCP Auth';
const MCP_HUB_REGISTRY_TABLE_ID = String(
  process.env.MCP_HUB_REGISTRY_TABLE_ID || 'GovChatMcpHubRegistry01',
).trim();
const MCP_HUB_REGISTRY_TABLE_NAME = 'MCP Hub Registry';
const MCP_HUB_REGISTRY_COLUMNS = [
  { name: 'mcp_id', type: 'string' },
  { name: 'server_name', type: 'string' },
  { name: 'tool_name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'input_schema', type: 'string' },
  { name: 'required_group_ids', type: 'string' },
  { name: 'public', type: 'boolean' },
  { name: 'enabled', type: 'boolean' },
  { name: 'synced_at', type: 'string' },
];

function runN8n(args) {
  execFileSync('n8n', args, { stdio: 'inherit' });
}

async function waitForSettings(maxRetries = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${N8N_URL}/rest/settings`);
      if (response.ok) return response.json();
    } catch {
      // n8n may need time to finish booting.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('n8n /rest/settings bleef onbereikbaar tijdens owner bootstrap');
}

async function loginCheck(email, password) {
  const response = await fetch(`${N8N_URL}/rest/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: email, password }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`n8n owner-login check mislukt voor ${email} (status ${response.status}): ${body}`);
  }
}

async function setupOwner(email, password, firstName, lastName) {
  const response = await fetch(`${N8N_URL}/rest/owner/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, firstName, lastName, password }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`n8n owner setup mislukt (status ${response.status}): ${body}`);
  }

  const settings = await waitForSettings();
  if (Boolean(settings?.data?.userManagement?.showSetupOnFirstLoad)) {
    throw new Error('Owner setup leek gelukt, maar n8n geeft nog steeds setup-scherm terug');
  }
}

async function ensureOwner() {
  const email = String(process.env.N8N_OWNER_EMAIL || '').trim();
  const password = String(process.env.N8N_OWNER_PASSWORD || '');
  const firstName = String(process.env.N8N_OWNER_FIRST_NAME || 'GovChat').trim();
  const lastName = String(process.env.N8N_OWNER_LAST_NAME || 'Admin').trim();
  const enforceOwner = String(process.env.N8N_OWNER_ENFORCE || 'true').trim().toLowerCase() === 'true';

  if (!email || !password) {
    console.log('[bootstrap] N8N owner bootstrap overgeslagen (N8N_OWNER_EMAIL/N8N_OWNER_PASSWORD leeg)');
    return;
  }

  const settings = await waitForSettings();
  const showSetup = Boolean(settings?.data?.userManagement?.showSetupOnFirstLoad);
  if (showSetup) {
    await setupOwner(email, password, firstName, lastName);
  } else {
    try {
      await loginCheck(email, password);
    } catch (error) {
      if (!enforceOwner) throw error;
      console.log(`[bootstrap] Bestaande owner komt niet overeen met .env credentials; reset user-management en provision owner opnieuw`);
      runN8n(['user-management:reset']);
      await setupOwner(email, password, firstName, lastName);
    }
  }

  await loginCheck(email, password);
  console.log(`[bootstrap] N8N owner-login check geslaagd voor ${email}`);
}

function importLiteLLMCredential() {
  const apiKey = String(process.env.LITELLM_API_KEY || '');
  const baseUrl = String(process.env.LITELLM_URL || '').replace(/\/$/, '');
  if (!apiKey) throw new Error("LITELLM_API_KEY ontbreekt; kan n8n credential niet bootstrap'en");
  if (!baseUrl) throw new Error("LITELLM_URL ontbreekt; kan n8n credential niet bootstrap'en");

  const credentialPath = '/tmp/litellm-openai-credential.json';
  fs.writeFileSync(
    credentialPath,
    JSON.stringify([
      {
        id: '00000000-0000-4000-8000-000000000111',
        name: 'LiteLLM API',
        type: 'openAiApi',
        data: { apiKey, url: `${baseUrl}/v1` },
      },
    ]),
    { mode: 0o600 },
  );
  try {
    runN8n([`import:credentials`, `--input=${credentialPath}`]);
  } finally {
    fs.rmSync(credentialPath, { force: true });
  }
}

function buildJemsCredential(env = process.env) {
  const apiKey = String(env.JEMS_MCP_API_KEY || '');
  const username = String(env.JEMS_MCP_USERNAME || env.JEMS_MCP_EMAIL || '');
  const password = String(env.JEMS_MCP_PASSWORD || '');
  const values = [apiKey, username, password];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) {
    throw new Error('JEMS_MCP_API_KEY, JEMS_MCP_USERNAME en JEMS_MCP_PASSWORD moeten samen zijn ingesteld');
  }

  const headers = [
    { name: 'X-API-Key', value: apiKey },
    { name: 'X-Jems-Email', value: username },
    { name: 'X-Jems-Password', value: password },
  ];
  return {
    id: JEMS_CREDENTIAL_ID,
    name: JEMS_CREDENTIAL_NAME,
    type: 'httpMultipleHeadersAuth',
    data: { headers: { values: headers } },
  };
}

function importJemsCredential() {
  const credential = buildJemsCredential();
  if (!credential) {
    console.log('[bootstrap] JEMS MCP credential import overgeslagen (JEMS credentials ontbreken)');
    return false;
  }

  const credentialPath = '/tmp/jems-mcp-credential.json';
  fs.writeFileSync(
    credentialPath,
    JSON.stringify([credential]),
    { mode: 0o600 },
  );
  try {
    runN8n([`import:credentials`, `--input=${credentialPath}`]);
  } finally {
    fs.rmSync(credentialPath, { force: true });
  }
  console.log('[bootstrap] JEMS MCP credential geïmporteerd (secret values niet gelogd)');
  return true;
}

async function ensureMcpHubRegistryDataTable() {
  if (!/^[a-zA-Z0-9]{1,36}$/.test(MCP_HUB_REGISTRY_TABLE_ID)) {
    throw new Error('MCP_HUB_REGISTRY_TABLE_ID must be 1-36 alphanumeric characters');
  }

  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST || 'n8n-postgres',
    port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
    database: process.env.DB_POSTGRESDB_DATABASE || 'n8n',
    user: process.env.DB_POSTGRESDB_USER || 'n8n',
    password: process.env.DB_POSTGRESDB_PASSWORD || '',
  });
  const workflowIds = [
    'govchat-orchestrator-litellm',
    'govchat-mcp-executor-hub',
    'govchat-mcp-registry-sync',
  ];
  const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;
  const tableName = `${String(process.env.DB_TABLE_PREFIX || '')}data_table_user_${MCP_HUB_REGISTRY_TABLE_ID}`;
  const quotedTableName = quoteIdentifier(tableName);
  const sqlType = (type) => (type === 'boolean' ? 'BOOLEAN' : 'TEXT');

  await client.connect();
  try {
    const projectResult = await client.query(
      'SELECT DISTINCT "projectId" FROM shared_workflow WHERE "workflowId" = ANY($1::varchar[])',
      [workflowIds],
    );
    const projectIds = projectResult.rows.map((row) => row.projectId);
    if (projectIds.length !== 1) {
      throw new Error(
        `MCP Hub workflows must belong to one n8n project before registry creation (found ${projectIds.length})`,
      );
    }
    const projectId = projectIds[0];

    await client.query('BEGIN');
    const byId = await client.query('SELECT id, name, "projectId" FROM data_table WHERE id = $1', [
      MCP_HUB_REGISTRY_TABLE_ID,
    ]);
    const byName = await client.query(
      'SELECT id, name, "projectId" FROM data_table WHERE name = $1 AND "projectId" = $2',
      [MCP_HUB_REGISTRY_TABLE_NAME, projectId],
    );

    if (byId.rows.length && (byId.rows[0].name !== MCP_HUB_REGISTRY_TABLE_NAME || byId.rows[0].projectId !== projectId)) {
      throw new Error(`Configured MCP registry table ID ${MCP_HUB_REGISTRY_TABLE_ID} is already used by another table/project`);
    }
    if (byName.rows.length && byName.rows[0].id !== MCP_HUB_REGISTRY_TABLE_ID) {
      throw new Error(
        `An MCP Hub Registry table already exists with ID ${byName.rows[0].id}; set MCP_HUB_REGISTRY_TABLE_ID to that ID`,
      );
    }

    if (!byId.rows.length) {
      await client.query(
        'INSERT INTO data_table (id, name, "projectId") VALUES ($1, $2, $3)',
        [MCP_HUB_REGISTRY_TABLE_ID, MCP_HUB_REGISTRY_TABLE_NAME, projectId],
      );
    }

    const columnRows = await client.query(
      'SELECT name, type, "index" FROM data_table_column WHERE "dataTableId" = $1',
      [MCP_HUB_REGISTRY_TABLE_ID],
    );
    const currentColumns = new Map(columnRows.rows.map((column) => [column.name, column]));
    for (let index = 0; index < MCP_HUB_REGISTRY_COLUMNS.length; index += 1) {
      const column = MCP_HUB_REGISTRY_COLUMNS[index];
      const existing = currentColumns.get(column.name);
      if (existing && existing.type !== column.type) {
        throw new Error(`MCP registry column ${column.name} has type ${existing.type}; expected ${column.type}`);
      }
      if (!existing) {
        await client.query(
          'INSERT INTO data_table_column (id, name, type, "index", "dataTableId") VALUES ($1, $2, $3, $4, $5)',
          [crypto.randomBytes(12).toString('hex'), column.name, column.type, index, MCP_HUB_REGISTRY_TABLE_ID],
        );
      }
    }

    const systemColumns = [
      '"id" SERIAL PRIMARY KEY',
      ...MCP_HUB_REGISTRY_COLUMNS.map((column) => `${quoteIdentifier(column.name)} ${sqlType(column.type)}`),
      '"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
    ];
    await client.query(`CREATE TABLE IF NOT EXISTS ${quotedTableName} (${systemColumns.join(', ')})`);

    const physicalColumns = await client.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      [tableName],
    );
    const physicalColumnNames = new Set(physicalColumns.rows.map((column) => column.column_name));
    for (const column of MCP_HUB_REGISTRY_COLUMNS) {
      if (!physicalColumnNames.has(column.name)) {
        await client.query(`ALTER TABLE ${quotedTableName} ADD COLUMN ${quoteIdentifier(column.name)} ${sqlType(column.type)}`);
      }
    }

    await client.query('COMMIT');
    console.log(
      `[bootstrap] MCP Hub Registry table ensured (id=${MCP_HUB_REGISTRY_TABLE_ID}, columns=${MCP_HUB_REGISTRY_COLUMNS.length})`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function discoverWorkflows(workflowsDir = WORKFLOWS_DIR, extraDirs = [MCP_HUB_WORKFLOWS_DIR]) {
  const directories = [...new Set([workflowsDir, ...extraDirs].map((dir) => String(dir).trim()).filter(Boolean))];
  const files = directories.flatMap((directory) => {
    if (!fs.existsSync(directory)) {
      if (directory === workflowsDir) throw new Error(`Workflow directory ontbreekt: ${directory}`);
      return [];
    }
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => ({ file: entry.name, fullPath: path.join(directory, entry.name) }))
      .sort((a, b) => a.file.localeCompare(b.file));
  });

  if (!files.length) throw new Error(`Geen workflow-JSON-bestanden gevonden in ${directories.join(', ')}`);

  const ids = new Set();
  return files.map(({ file, fullPath }) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (error) {
      throw new Error(`Ongeldige workflow-JSON in ${file}: ${error.message}`);
    }

    const workflows = Array.isArray(parsed) ? parsed : [parsed];
    if (!workflows.length || workflows.some((workflow) => !workflow || !Array.isArray(workflow.nodes))) {
      throw new Error(`${file} bevat geen geldige n8n workflow(s) met een nodes-array`);
    }

    for (const workflow of workflows) {
      const id = String(workflow.id || '').trim();
      if (!id) throw new Error(`Workflow in ${file} mist een stabiele id`);
      if (ids.has(id)) throw new Error(`Dubbele workflow-id "${id}" aangetroffen in ${file}`);
      ids.add(id);
    }

    return { file, fullPath, ids: workflows.map((workflow) => String(workflow.id).trim()) };
  });
}

function importVerifyAndPublish(workflows) {
  const force = String(process.env.AGENTS_BOOTSTRAP_FORCE || 'false').trim().toLowerCase() === 'true';
  if (!force && fs.existsSync(MARKER_FILE)) {
    console.log('[bootstrap] Skip import/publish (already seeded; set AGENTS_BOOTSTRAP_FORCE=true to force)');
    return;
  }

  console.log(`[bootstrap] Import/publish ${workflows.length} workflowbestand(en) (force=${force})`);
  for (const workflow of workflows) {
    console.log(`[bootstrap] Import ${workflow.file}`);
    runN8n([`import:workflow`, `--input=${workflow.fullPath}`]);
  }

  let exportIndex = 0;
  for (const workflow of workflows) {
    for (const id of workflow.ids) {
      const verificationPath = `/tmp/verify-workflow-${exportIndex++}.json`;
      runN8n([`export:workflow`, `--id=${id}`, `--output=${verificationPath}`]);
    }
  }

  for (const workflow of workflows) {
    for (const id of workflow.ids) runN8n([`publish:workflow`, `--id=${id}`]);
  }

  fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
  fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf8');
  console.log('[bootstrap] Workflow import/publish geverifieerd');
}

async function main() {
  const workflows = discoverWorkflows();
  console.log(`[bootstrap] Ontdekte workflows: ${workflows.map((workflow) => workflow.file).join(', ')}`);
  console.log('[bootstrap] Controleer n8n owner setup...');
  await ensureOwner();
  importLiteLLMCredential();
  importJemsCredential();
  importVerifyAndPublish(workflows);
  await ensureMcpHubRegistryDataTable();
}

module.exports = { buildJemsCredential, discoverWorkflows, ensureMcpHubRegistryDataTable, importJemsCredential };

if (require.main === module) {
  main().catch((error) => {
    console.error('[bootstrap] Fout:', error);
    process.exitCode = 1;
  });
}
