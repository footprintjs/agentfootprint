import { ECOSYSTEM_PROJECTS } from './ecosystem';
import { SITE } from './site';

export function llmsSiteIntro() {
  const projects = ECOSYSTEM_PROJECTS.map((project) => {
    const links = [
      `[website](${project.url})`,
      `[source](${project.repo})`,
      ...('npm' in project ? [`[npm](${project.npm})`] : []),
    ].join(' · ');

    return `- **${project.name}** — ${project.description} ${links}`;
  }).join('\n');

  return `# AgentFootprint

> ${SITE.description}

- Website: ${SITE.url}/
- Source: ${SITE.repo}
- npm: ${SITE.npm}
- Creator: ${SITE.authorName} (${SITE.authorUrl})

## Product and technical views

- Product: ${SITE.url}/?view=product
- Technical: ${SITE.url}/?view=technical

## footprintjs ecosystem

AgentFootprint is one of seven connected open-source projects. Each records or presents causal evidence at a different layer.

${projects}`;
}

