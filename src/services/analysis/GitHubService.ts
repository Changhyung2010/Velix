/**
 * GitHubService - GitHub API integration
 *
 * Provides repository info fetching, full repo analysis, and similar repo search.
 * Ported from Loom's GitHub analysis capabilities.
 */

export interface GitHubRepoInfo {
    repo: string;
    url: string;
    description: string;
    stars: number;
    language: string;
    createdAt: string;
    updatedAt: string;
    commitCount: number;
    defaultBranch: string;
}

export interface SimilarRepo {
    repo: string;
    url: string;
    description: string;
    stars: number;
    language: string;
}

export interface GitHubContributor {
    username: string;
    contributions: number;
    avatarUrl: string;
    profileUrl: string;
}

export interface GitHubBranch {
    name: string;
    protected: boolean;
    commitSha: string | null;
}

export interface GitHubRelease {
    tagName: string;
    publishedAt: string;
}

export interface GitHubFullAnalysis {
    summary: {
        name: string;
        fullName: string;
        description: string;
        url: string;
        stars: number;
        forks: number;
        language: string | null;
        license: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        topics: string[];
    };
    contributors: GitHubContributor[];
    commits: {
        totalCommits: number;
        commitsByAuthor: Record<string, number>;
    };
    releases: {
        firstRelease: GitHubRelease | null;
        latestRelease: GitHubRelease | null;
        totalReleases: number;
    };
    languages: Record<string, number>;
    branches: GitHubBranch[];
}

/**
 * Extract owner/repo from GitHub URL
 */
function extractGitHubRepo(url: string): { owner: string; repo: string } | null {
    if (!url?.trim()) return null;

    let normalized = url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        if (normalized.includes('github.com')) {
            normalized = `https://${normalized}`;
        } else {
            normalized = `https://github.com/${normalized}`;
        }
    }

    normalized = normalized.split('?')[0].split('#')[0].replace(/\/+$/, '');

    const match = normalized.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
    if (match && match[1] && match[2]) {
        return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, ''),
        };
    }

    return null;
}

/**
 * GitHub Service class
 */
export class GitHubService {
    private headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Velix-IDE/1.0',
    };

    /**
     * Make a GitHub API request
     */
    private async apiRequest<T>(endpoint: string): Promise<T | null> {
        try {
            const response = await fetch(
                `https://api.github.com${endpoint}`,
                { headers: this.headers }
            );

            if (response.status === 404) return null;
            if (response.status === 403 || response.status === 429) {
                throw new Error('GitHub API rate limit exceeded. Try again later.');
            }
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            if (err instanceof Error && err.message.includes('rate limit')) throw err;
            console.error('GitHub API request failed:', err);
            return null;
        }
    }

    /**
     * Fetch full GitHub repository analysis (like Loom's github-repo-all)
     */
    async fetchFullAnalysis(githubUrl: string): Promise<GitHubFullAnalysis | null> {
        const parsed = extractGitHubRepo(githubUrl);
        if (!parsed) return null;

        const { owner, repo } = parsed;

        // Fetch all data in parallel
        const [repoData, contributorsData, releasesData, languagesData, branchesData] = await Promise.allSettled([
            this.apiRequest<any>(`/repos/${owner}/${repo}`),
            this.apiRequest<any[]>(`/repos/${owner}/${repo}/contributors?per_page=30`),
            this.apiRequest<any[]>(`/repos/${owner}/${repo}/releases?per_page=10`),
            this.apiRequest<Record<string, number>>(`/repos/${owner}/${repo}/languages`),
            this.apiRequest<any[]>(`/repos/${owner}/${repo}/branches?per_page=30`),
        ]);

        if (repoData.status === 'rejected' || !repoData.value) {
            return null;
        }

        const rd = repoData.value;

        // Process contributors
        const contributors: GitHubContributor[] = [];
        let totalCommits = 0;
        const commitsByAuthor: Record<string, number> = {};

        if (contributorsData.status === 'fulfilled' && Array.isArray(contributorsData.value)) {
            for (const c of contributorsData.value) {
                contributors.push({
                    username: c.login,
                    contributions: c.contributions,
                    avatarUrl: c.avatar_url,
                    profileUrl: c.html_url,
                });
                commitsByAuthor[c.login] = c.contributions;
                totalCommits += c.contributions;
            }
        }

        // Process releases
        let firstRelease: GitHubRelease | null = null;
        let latestRelease: GitHubRelease | null = null;
        let totalReleases = 0;
        if (releasesData.status === 'fulfilled' && Array.isArray(releasesData.value) && releasesData.value.length > 0) {
            totalReleases = releasesData.value.length;
            latestRelease = { tagName: releasesData.value[0].tag_name, publishedAt: releasesData.value[0].published_at };
            const last = releasesData.value[releasesData.value.length - 1];
            firstRelease = { tagName: last.tag_name, publishedAt: last.published_at };
        }

        // Process languages
        const languages = (languagesData.status === 'fulfilled' && languagesData.value) ? languagesData.value : {};

        // Process branches
        const branches: GitHubBranch[] = [];
        if (branchesData.status === 'fulfilled' && Array.isArray(branchesData.value)) {
            for (const b of branchesData.value) {
                branches.push({
                    name: b.name,
                    protected: b.protected || false,
                    commitSha: b.commit?.sha || null,
                });
            }
        }

        return {
            summary: {
                name: rd.name,
                fullName: rd.full_name,
                description: rd.description || '',
                url: rd.html_url,
                stars: rd.stargazers_count || 0,
                forks: rd.forks_count || 0,
                language: rd.language || null,
                license: rd.license?.name || null,
                createdAt: rd.created_at || null,
                updatedAt: rd.updated_at || null,
                topics: rd.topics || [],
            },
            contributors,
            commits: { totalCommits, commitsByAuthor },
            releases: { firstRelease, latestRelease, totalReleases },
            languages,
            branches,
        };
    }

    /**
     * Fetch GitHub repository information
     */
    async fetchRepoInfo(githubUrlOrRepo: string): Promise<GitHubRepoInfo | null> {
        const parsed = extractGitHubRepo(githubUrlOrRepo);
        if (!parsed) return null;

        const { owner, repo } = parsed;

        try {
            const data = await this.apiRequest<any>(`/repos/${owner}/${repo}`);
            if (!data) return null;

            return {
                repo: `${owner}/${repo}`,
                url: data.html_url || `https://github.com/${owner}/${repo}`,
                description: data.description || '',
                stars: data.stargazers_count || 0,
                language: data.language || '',
                createdAt: data.created_at || '',
                updatedAt: data.updated_at || '',
                commitCount: 0,
                defaultBranch: data.default_branch || 'main',
            };
        } catch (err) {
            console.error('Error fetching GitHub repo info:', err);
            return null;
        }
    }

    /**
     * Search for similar repositories on GitHub
     */
    async searchSimilarRepos(
        codeSnippet: string,
        language: string,
        limit: number = 5
    ): Promise<SimilarRepo[]> {
        const similarRepos: SimilarRepo[] = [];

        try {
            const keywords = this.extractKeywords(codeSnippet, language);
            if (keywords.length === 0) return [];

            const searchTerms = keywords.slice(0, 6).join(' ');
            const encodedQuery = encodeURIComponent(searchTerms);

            const data = await this.apiRequest<any>(
                `/search/repositories?q=${encodedQuery}&sort=stars&per_page=${limit}`
            );

            if (data?.items) {
                for (const item of data.items) {
                    similarRepos.push({
                        repo: item.full_name,
                        url: item.html_url,
                        description: (item.description || '').slice(0, 100),
                        stars: item.stargazers_count || 0,
                        language: item.language || '',
                    });
                }
            }
        } catch (err) {
            console.error('Error searching GitHub:', err);
        }

        return similarRepos;
    }

    /**
     * Extract keywords from code for searching
     */
    private extractKeywords(code: string, language: string): string[] {
        const keywords: string[] = [];

        if (language) keywords.push(language);

        const frameworkKeywords = [
            'react', 'vue', 'angular', 'express', 'fastapi', 'django', 'flask',
            'nextjs', 'electron', 'tauri', 'tensorflow', 'pytorch', 'pandas',
        ];

        const codeLower = code.toLowerCase();
        for (const fw of frameworkKeywords) {
            if (codeLower.includes(fw)) keywords.push(fw);
        }

        const importPatterns = [
            /from\s+(\w+)/g,
            /import\s+["']([^"']+)["']/g,
            /require\(["']([^"']+)["']\)/g,
        ];

        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(code)) !== null) {
                const imp = match[1].split('/')[0].split('.')[0];
                if (imp.length > 2 && imp.length < 20) keywords.push(imp);
            }
        }

        return [...new Set(keywords.map(k => k.toLowerCase()))].slice(0, 10);
    }
}

// Export singleton instance
export const githubService = new GitHubService();
