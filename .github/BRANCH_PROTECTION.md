# Branch Protection Rules

Recommended branch protection settings for the **myfinpro** repository.

## `main` Branch

The `main` branch represents production-ready code. Apply these protection rules:

### Required Status Checks

Enable **"Require status checks to pass before merging"** with the following checks:

| Status Check          | Workflow       | Description                          |
| --------------------- | -------------- | ------------------------------------ |
| `Lint & Typecheck`    | `ci.yml`       | ESLint, TypeScript, Prettier         |
| `Unit Tests`          | `ci.yml`       | All unit test suites must pass       |
| `Build`               | `ci.yml`       | Full monorepo build must succeed     |
| `PR Title Convention` | `pr-check.yml` | Conventional Commits format enforced |

Enable **"Require branches to be up to date before merging"** to ensure PRs are tested against the latest `main`.

### Required Reviews

- **Require at least 1 approving review** before merging
- **Dismiss stale pull request approvals** when new commits are pushed
- **Require review from Code Owners** (when CODEOWNERS file is added)

### Additional Settings

- ✅ **Require signed commits** (recommended)
- ✅ **Require linear history** (enforce squash or rebase merges)
- ✅ **Do not allow bypassing the above settings** (even for admins)
- ❌ **Do not allow force pushes**
- ❌ **Do not allow deletions**

---

## `develop` Branch

The `develop` branch is the integration branch for features. Apply similar but slightly relaxed rules:

### Required Status Checks

Same as `main`:

| Status Check       | Workflow |
| ------------------ | -------- |
| `Lint & Typecheck` | `ci.yml` |
| `Unit Tests`       | `ci.yml` |
| `Build`            | `ci.yml` |

Enable **"Require branches to be up to date before merging"**.

### Required Reviews

- **Require at least 1 approving review** before merging
- **Dismiss stale pull request approvals** when new commits are pushed

### Additional Settings

- ✅ **Require linear history**
- ❌ **Do not allow force pushes**
- ❌ **Do not allow deletions**

---

## How to Configure

### Via GitHub UI

1. Go to **Settings → Branches → Branch protection rules**
2. Click **"Add branch protection rule"**
3. Enter the branch name pattern (e.g., `main`)
4. Configure the settings as described above
5. Click **"Create"**
6. Repeat for `develop`

### Via GitHub CLI

```bash
# Protect main branch
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Lint & Typecheck","Unit Tests","Build"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null

# Protect develop branch
gh api repos/{owner}/{repo}/branches/develop/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Lint & Typecheck","Unit Tests","Build"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null
```

---

## Merge Strategy

The recommended merge strategy is **Squash and merge** for all PRs:

- Keeps `main` and `develop` history linear and clean
- Each PR becomes a single commit with a conventional commit message
- Configure in **Settings → General → Pull Requests**:
  - ✅ Allow squash merging (set as default)
  - ❌ Allow merge commits (disable)
  - ❌ Allow rebase merging (disable)
