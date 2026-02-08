// Analysis services barrel export
export { codeAnalysisService, CodeAnalysisService } from './CodeAnalysisService';
export type { FileInfo, ProjectData, DangerZone } from './CodeAnalysisService';
export { extractImports, detectDangerZones, getLanguageFromExtension, scanProjectDirectory } from './CodeAnalysisService';

export { gitAnalysisService, GitAnalysisService } from './GitAnalysisService';
export type { GitCommit, FileEvolution, GitRemoteInfo } from './GitAnalysisService';

export { githubService, GitHubService } from './GitHubService';
export type { GitHubRepoInfo, SimilarRepo, GitHubFullAnalysis, GitHubContributor, GitHubBranch, GitHubRelease } from './GitHubService';
