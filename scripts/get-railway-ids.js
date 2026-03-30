#!/usr/bin/env node
/**
 * Fetch Railway Service ID and Environment ID from the Railway API.
 *
 * Usage:
 *   RAILWAY_TOKEN=<token> RAILWAY_PROJECT_ID=<project-id> node scripts/get-railway-ids.js
 *
 * After running, add RAILWAY_SERVICE_ID to your GitHub Secrets.
 */

const token = process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID;

if (!token || !projectId) {
  console.error('Missing required env vars.');
  console.error('Usage: RAILWAY_TOKEN=<token> RAILWAY_PROJECT_ID=<project-id> node scripts/get-railway-ids.js');
  process.exit(1);
}

async function main() {
  const query = `
    query {
      project(id: "${projectId}") {
        name
        services {
          edges {
            node {
              id
              name
            }
          }
        }
        environments {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();

  if (data.errors) {
    console.error('Railway API error:', data.errors[0].message);
    process.exit(1);
  }

  const project = data.data.project;
  console.log(`\nProject: ${project.name}\n`);

  console.log('Services:');
  for (const edge of project.services.edges) {
    console.log(`  ${edge.node.name}`);
    console.log(`    RAILWAY_SERVICE_ID=${edge.node.id}`);
  }

  console.log('\nEnvironments:');
  for (const edge of project.environments.edges) {
    console.log(`  ${edge.node.name}`);
    console.log(`    RAILWAY_ENVIRONMENT_ID=${edge.node.id}`);
  }

  console.log('\n--- Copy the RAILWAY_SERVICE_ID above and add it to GitHub Secrets ---');
}

main().catch(console.error);
