#!/usr/bin/env node
'use strict';

const path = require('path');
const { discoverWorkflows } = require('../../n8n/bootstrap');

const workflowsDir = path.resolve(__dirname, '../../agents/n8n/workflows');
const workflows = discoverWorkflows(workflowsDir);
const workflowIds = workflows.flatMap((entry) => entry.ids);
if (new Set(workflowIds).size !== workflowIds.length) {
  throw new Error('Discovered workflow IDs are not unique');
}

for (const workflow of workflows) console.log(`[PASS] ${workflow.file}`);
console.log(`Validated ${workflows.length} discovered workflow export(s); ${workflowIds.length} unique workflow ID(s).`);
