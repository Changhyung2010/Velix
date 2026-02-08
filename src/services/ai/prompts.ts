/**
 * AI Prompts for Code Analysis
 * 
 * Ported from Loom's agent.py - following the same structured analysis approach
 */

import { DangerZone, FileInfo, ProjectData } from '../analysis';
import { GitRemoteInfo, FileEvolution } from '../analysis';
import { SimilarRepo } from '../analysis';

/**
 * Loom-style system prompt for code interpretation
 */
export const CODE_ANALYSIS_SYSTEM_PROMPT = `You are a codebase interpreter.

YOUR PURPOSE:
You help developers UNDERSTAND existing code. You do NOT write new code, autocomplete, or replace Copilot.
You explain structure, intent, history, and risk.

CORE PRINCIPLES:
1. Honesty over confidence - say "uncertain" rather than hallucinate
2. Never invent intent - only infer from evidence (code, commits, patterns)
3. Never shame code - explain why it might be this way
4. Developer empathy - assume past decisions had reasons
5. Evidence-based - cite specific code, commits, patterns

OUTPUT RULES:
- Structured with clear headings
- Calm, professional tone
- No emojis in output
- No hype language
- Bullet points for lists
- Code references in backticks`;

/**
 * Build the file analysis prompt
 */
export function buildFileAnalysisPrompt(options: {
    filePath: string;
    code: string;
    imports: string[];
    gitHistory?: string;
    remoteInfo?: GitRemoteInfo | null;
    evolution?: FileEvolution | null;
    dangerZones?: DangerZone | null;
    similarRepos?: SimilarRepo[];
    mode?: 'beginner' | 'senior';
}): string {
    const {
        filePath,
        code,
        imports,
        gitHistory = 'No git history available',
        remoteInfo,
        evolution,
        dangerZones,
        similarRepos = [],
        mode = 'senior',
    } = options;

    const fileName = filePath.split('/').pop() || filePath;
    const importsText = imports.length > 0 ? imports.slice(0, 30).join('\n') : 'No imports found';

    // Truncate code if too long
    let codeContent = code.slice(0, 8000);
    if (code.length > 8000) {
        codeContent += '\n\n[... truncated ...]';
    }

    // Mode-specific instructions
    const modeInstructions = mode === 'beginner'
        ? `OUTPUT STYLE: Beginner-friendly
- Use simple, clear language
- Define technical terms inline when first used
- Explain concepts step by step
- Use analogies where helpful
- Be thorough in explanations`
        : `OUTPUT STYLE: Senior developer
- Be concise and direct
- Assume technical knowledge
- Focus on architecture, risks, and non-obvious details
- Skip basic explanations
- Highlight what matters for maintenance and changes`;

    // Build optional context sections
    let repoContext = '';
    if (remoteInfo?.githubRepo) {
        repoContext = `
Repository: ${remoteInfo.githubRepo}
URL: ${remoteInfo.githubUrl || 'N/A'}
Total Commits: ${remoteInfo.totalCommits || 'Unknown'}
Project Start: ${remoteInfo.firstCommitDate || 'Unknown'}
Contributors: ${remoteInfo.contributors?.slice(0, 5).map(c => c.name).join(', ') || 'Unknown'}`;
    }

    let evolutionContext = '';
    if (evolution) {
        const authors = evolution.authors?.slice(0, 3).map(a => a.name).join(', ') || 'Unknown';
        evolutionContext = `
File Commits: ${evolution.totalFileCommits || 0}
File Authors: ${authors}
Lines Added: +${evolution.linesAddedTotal || 0}
Lines Removed: -${evolution.linesRemovedTotal || 0}`;

        if (evolution.timeline?.length) {
            evolutionContext += '\nRecent Changes:\n';
            for (const t of evolution.timeline.slice(0, 5)) {
                evolutionContext += `  [${t.date}] ${t.author}: ${t.message}\n`;
            }
        }
    }

    let dangerContext = '';
    if (dangerZones) {
        dangerContext = `
Risk Level: ${dangerZones.riskLevel.toUpperCase()}
Change Frequency: ${dangerZones.changeFrequency}
Test Coverage: ${dangerZones.testCoverage}`;

        if (dangerZones.warnings?.length) {
            dangerContext += '\nWarnings:\n';
            for (const w of dangerZones.warnings) {
                dangerContext += `  - ${w}\n`;
            }
        }
        if (dangerZones.complexityIndicators?.length) {
            dangerContext += 'Complexity:\n';
            for (const c of dangerZones.complexityIndicators) {
                dangerContext += `  - ${c}\n`;
            }
        }
    }

    let similarContext = '';
    if (similarRepos.length > 0) {
        similarContext = 'Related GitHub repositories:\n';
        for (const repo of similarRepos.slice(0, 5)) {
            similarContext += `  - ${repo.repo}`;
            if (repo.stars) similarContext += ` (${repo.stars} stars)`;
            similarContext += '\n';
            if (repo.description) similarContext += `    ${repo.description}\n`;
            similarContext += `    ${repo.url}\n`;
        }
    }

    return `Analyze this file and help a developer understand it.

FILE: ${fileName}
PATH: ${filePath}
${modeInstructions}

=== CODE ===
${codeContent}

=== DEPENDENCIES ===
${importsText}

=== GIT HISTORY ===
${gitHistory.slice(0, 1500)}

=== REPOSITORY INFO ===
${repoContext}

=== FILE EVOLUTION ===
${evolutionContext}

=== RISK ANALYSIS ===
${dangerContext}

=== RELATED PROJECTS ===
${similarContext}

=== REQUIRED ANALYSIS ===

Provide your analysis with these sections:

# [File Name] - Purpose

One paragraph explaining WHY this file exists and what problem it solves.

## File Role in Codebase

- What is this file's responsibility?
- Who imports/uses this file?
- What would break if this file was removed?

## Architecture and Design Decisions

- What patterns are used and why?
- Any notable design choices?
- Historical constraints that may explain the approach?

## Key Components

For each important function/class:
- Name and purpose
- Inputs and outputs
- Side effects or risks

## Dependency Impact

- What this file depends on
- What depends on this file
- Risk level if changed: Low / Medium / High

## Git History Insights

Based on commit history:
- Why was this code introduced?
- Any hotfixes or rushed changes visible?
- Evolution pattern (stable, frequently changed, recently rewritten)

## Danger Zones

- Areas that need careful attention
- Missing test coverage
- Complex or fragile sections
- Technical debt indicators

## Change Recommendations

If someone needs to modify this file:
- What should they understand first?
- What are the safest approaches?
- What should they NOT touch without careful review?

---

Remember:
- Be specific, cite actual code elements
- If uncertain about something, say so
- Explain the "why", not just the "what"
- No emojis, keep it professional`;
}

/**
 * Build the project analysis prompt
 */
export function buildProjectAnalysisPrompt(options: {
    projectData: ProjectData;
    filesContent: Array<{ path: string; content: string; imports: string[] }>;
    remoteInfo?: GitRemoteInfo | null;
    similarRepos?: SimilarRepo[];
    mode?: 'beginner' | 'senior';
}): string {
    const {
        projectData,
        filesContent,
        remoteInfo,
        similarRepos = [],
        mode = 'senior',
    } = options;

    // Build file structure section
    let structureText = `# Project Structure Analysis\n\n`;
    structureText += `**Total Files Analyzed:** ${projectData.files.length}\n\n`;

    // Group by directory
    const byDir: Record<string, FileInfo[]> = {};
    for (const file of projectData.files) {
        const parts = file.path.split('/');
        parts.pop();
        const dir = parts.length > 0 ? parts.join('/') : 'root';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(file);
    }

    structureText += '## Directory Structure\n\n';
    for (const dir of Object.keys(byDir).sort()) {
        const files = byDir[dir];
        structureText += `### \`${dir}/\` (${files.length} files)\n\n`;
        for (const file of files.slice(0, 10)) {
            const depsCount = projectData.dependencies[file.path]?.length || 0;
            structureText += `- \`${file.name}\` (${file.extension}, ${file.size} chars, ${depsCount} deps)\n`;
        }
        structureText += '\n';
    }

    // Dependencies summary
    const depsText = Object.entries(projectData.dependencies)
        .filter(([_, deps]) => deps.length > 0)
        .slice(0, 30)
        .map(([file, deps]) => `- ${file.split('/').pop()} -> ${deps.slice(0, 5).join(', ')}`)
        .join('\n');

    // File contents
    const filesText = filesContent.slice(0, 10).map(f => `## File: \`${f.path.split('/').pop()}\`

**Path:** ${f.path}
**Imports:** ${f.imports.slice(0, 10).join(', ') || 'None'}

\`\`\`
${f.content.slice(0, 3000)}${f.content.length > 3000 ? '\n... (truncated)' : ''}
\`\`\`
`).join('\n\n');

    // Repo context
    let repoContext = '';
    if (remoteInfo?.githubRepo) {
        repoContext = `## Repository Information

Repository: ${remoteInfo.githubRepo}
URL: ${remoteInfo.githubUrl || 'N/A'}
Total Commits: ${remoteInfo.totalCommits || 'Unknown'}
Contributors: ${remoteInfo.contributors?.slice(0, 5).map(c => c.name).join(', ') || 'Unknown'}
`;
    }

    // Similar repos
    let similarContext = '';
    if (similarRepos.length > 0) {
        similarContext = '## Related GitHub Repositories\n\n';
        for (const repo of similarRepos.slice(0, 5)) {
            similarContext += `- **${repo.repo}**`;
            if (repo.stars) similarContext += ` (${repo.stars} stars)`;
            similarContext += '\n';
            if (repo.description) similarContext += `  ${repo.description}\n`;
            similarContext += `  ${repo.url}\n\n`;
        }
    }

    const modeNote = mode === 'beginner'
        ? 'Explain concepts in a beginner-friendly way with examples.'
        : 'Be concise and technical, assume senior developer knowledge.';

    return `Analyze this code project and provide comprehensive insights.

${structureText}

## Dependency Relationships

${depsText}

${repoContext}
${similarContext}

## File Contents

${filesText}

Please provide a comprehensive analysis:
1. An overview of the project's purpose and architecture
2. Detailed explanation of how the main components/modules work together
3. For each file, a detailed description of what it does
4. How files are connected and depend on each other
5. Any patterns, architectural decisions, or design choices you notice
6. Explain the actual code logic, not just the structure

${modeNote}

Format your response with clear sections and use markdown headers. Be thorough and analyze the actual code content.`;
}

/**
 * Build chat context prompt for code Q&A
 */
export function buildChatContextPrompt(options: {
    userQuestion: string;
    filePath?: string;
    fileContent?: string;
    previousAnalysis?: string;
    projectContext?: string;
}): string {
    const { userQuestion, filePath, fileContent, previousAnalysis, projectContext } = options;

    let context = '';

    if (previousAnalysis) {
        context += `=== PREVIOUS ANALYSIS ===\n${previousAnalysis.slice(0, 4000)}\n\n`;
    }

    if (filePath && fileContent) {
        context += `=== CURRENT FILE ===\nPath: ${filePath}\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\`\n\n`;
    }

    if (projectContext) {
        context += `=== PROJECT CONTEXT ===\n${projectContext.slice(0, 2000)}\n\n`;
    }

    return `You are helping a developer understand their codebase. Answer their question based on the context provided.

${context}

=== USER QUESTION ===
${userQuestion}

Provide a clear, helpful answer. Be specific and reference actual code when relevant. If you're uncertain about something, say so.`;
}

export const CHAT_SYSTEM_PROMPT = `You are a helpful code assistant. You help developers understand their codebase by answering questions about code structure, functionality, and best practices.

Be specific and cite actual code elements when relevant. If uncertain, acknowledge it rather than guessing.`;
