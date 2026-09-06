# Project deployment setup

Open **Deploy Setup** from a project card. Choose a saved SSH server and a workflow target. The app can reconnect using the saved server credentials. Preparing a server installs packages and changes its configuration; it does not publish local repository changes or run GitHub workflows.

## Private network / VPN

Choose **Server pulls images**. The app detects `deploy/stack.yml`, `deploy/server.env.example`, a `deploy/*autodeploy*.sh` updater and `deploy/nginx.conf`. A Compose project without an updater gets a generated image-pull script.

1. Import a local env or fill the server environment fields. Required fields come from the updater's `required_vars` and Compose requirements. Template placeholders are not treated as credentials. For a new application, **Generate empty app keys** fills application keys and database passwords; provider credentials still come from their respective services.
2. Existing server env values are preserved. Enable **Replace existing server values** to apply non-empty form values over existing ones. Service-specific env names (for example `DATABASE_PASSWORD` → `POSTGRES_PASSWORD`) are mapped using Compose. Env values are never executed during local import and are safely quoted before the installed script sources them. They are not stored in application settings.
3. Enable the detected nginx config if required. Set the public domain. TLS files must already exist at the paths in that config or be supplied in the wizard as a matching certificate/key pair.
4. Preparation checks/installs Docker Engine, Compose and runtime tools, creates the deploy account and installs its SSH key, installs the Compose file, updater, env and launcher, validates their syntax, and enables cron if selected. An existing project cron file from the previous setup layout is backed up when it points at the same updater. File replacement waits for the managed updater lock and the detected project updater lock. The generated cron runs as root and writes a private log in `<base>/run/autodeploy.log`.
5. Optionally run the first deployment. Otherwise the result states that preparation is complete and the first deployment was not run by the wizard. Cron may subsequently deploy published images.

For KPCEP, `KPCEP_BASE_DIR` follows the selected remote base, while digest-derived image references remain the updater's responsibility. Its GHCR API checks need `GHCR_USERNAME` and `GHCR_TOKEN` in server env; Docker Hub login cannot substitute for them. Existing script behavior, health checks, pinned digests and notifications remain intact. The launcher uses a separate release-state file and a configuration checksum so changes to Compose, env or the updater trigger a deployment even when image digests are unchanged.

For a plain Compose image-pull project, the result gives `sudo docker login` (or `sudo docker login ghcr.io`) because the scheduled updater runs as root. Compose must reference published images, not local builds. Relative bind mounts and `env_file` require an explicit deploy layout and are rejected before installation rather than silently omitted.

## Direct GitHub / Ansible

Choose **GitHub → server** and the exact Ansible deployment step. YAML comments are excluded. Build job dependencies are included, while credentials from sibling deployment steps are excluded.

The Strapi/Astro example yields separate development, production UA and production NL targets. Preparation installs Docker, Compose and Python and configures the deploy user and SSH key. GitHub's existing Ansible playbook remains responsible for deploying images and the runtime environment from its vars. The wizard supplies the exact secret names bound to `key`, `inventory` and `known_hosts`, including environment/country suffixes and existing spelling. It does not invent an Ansible Vault password: encrypted vars require their existing password.

Keys shared by several targets in one project are reused through Electron safeStorage. An existing GitHub private key can also be supplied. If secure storage is unavailable, keys are reused in memory while the app is open, and the result asks the user to copy the key for future app sessions. Both profiles provide a separate copy action for the server SSH private key. Env values, TLS private keys and plaintext SSH private keys are never written to settings. Passwordless sudo is optional; Docker group membership is provided for Docker operations.

The production playbook in the example uses an external MySQL/MariaDB database. This existing application dependency and its credentials remain in the project's encrypted vars; the app does not silently substitute a new database.

## Results and failure handling

The result lists completed steps, installed paths, remaining GitHub secrets/variables, registry instructions and cron status. Instructions and credentials can be copied separately; secret values are masked initially. Remote exit codes are checked. A failed preparation returns the completed steps and does not claim success. Env/Compose validation precedes cron activation. A dedicated existing nginx site for the same domain is updated instead of creating a duplicate. Shared files with unrelated domains are not replaced. nginx is tested before reload; failed configuration restores previous config and supplied TLS files. Changed files retain a `.devscanner-backup` copy. Temporary uploads use a private directory and are cleaned up at the end.

Automatic Docker installation supports Ubuntu/Debian, using the [Docker package repository](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository). Existing Docker/Compose installations are checked before installing packages. GitHub supplies [`GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token) automatically, so it is omitted from manual secrets. Existing encrypted vars require their [Ansible Vault password](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault.html).

## Verification

`npm test` covers workflow target isolation, env import/quoting, secret mapping, repeated setup, SSH failure paths, nginx rollback, cron ordering and the renderer flow. Generated shell scripts are also executed locally with a fake Docker executable to verify pull-before-up behavior and configuration-triggered updates. `npm run build` packages the Electron application. Tests do not connect to production servers or publish images.
