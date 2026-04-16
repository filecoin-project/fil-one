# Dependabot Auto-Merge Setup

The workflow `.github/workflows/dependabot-auto-merge.yml` automatically
squash-merges Dependabot PRs. It authenticates with a Personal Access Token
(PAT) stored in the `DEPENDABOT_TOKEN` repository secret instead of the
automatic `GITHUB_TOKEN`, because commits created by `GITHUB_TOKEN` do not
trigger subsequent workflow runs (a GitHub limitation to prevent infinite
loops).

## Creating the token

1. Go to **GitHub > Settings > Developer settings > Personal access tokens >
   Fine-grained tokens**.
2. Create a new token scoped to the `filone` repository with these permissions:
   - **Contents** — Read and write
   - **Pull requests** — Read and write
3. Store the token as a repository secret:
   ```sh
   gh secret set DEPENDABOT_TOKEN
   ```
   Paste the token value when prompted.

The token should belong to a user with write access to the repository. Fine-grained
tokens have a maximum lifetime, so the token must be rotated before it expires.
