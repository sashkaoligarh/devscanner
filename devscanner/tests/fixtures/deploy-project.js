import fs from 'fs'
import path from 'path'

export function write(root, file, content = '') {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}

export function privateProject(root) {
  write(root, 'deploy/stack.yml', `services:
  cms:
    image: \${CMS_IMAGE_REF}
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      OPTIONAL_TOKEN: \${OPTIONAL_TOKEN:-}
    ports: ['127.0.0.1:1337:1337']
`)
  write(root, 'deploy/server.env.example', `APP_BASE_DIR=/opt/example
CMS_IMAGE_REPO=ghcr.io/example/cms
POSTGRES_PASSWORD=secure_password_here
OPTIONAL_TOKEN=
PUBLIC_SITE_URL=https://your-domain.com
`)
  write(root, 'deploy/app-autodeploy.sh', `#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="\${APP_BASE_DIR:-/opt/example}"
STATE_FILE="\${STATE_FILE:-$BASE_DIR/run/current-release.env}"
required_vars=(POSTGRES_PASSWORD CMS_IMAGE_REPO)
set -a
source "$BASE_DIR/env/server.env"
set +a
CMS_IMAGE_REF="\${CMS_IMAGE_REPO}:latest"
export CMS_IMAGE_REF
docker compose -f "$BASE_DIR/stack/stack.yml" up -d
`)
  write(root, '.github/workflows/publish.yml', `name: Build images
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo publish
        env:
          TOKEN: \${{ secrets.GITHUB_TOKEN }}
          URL: \${{ vars.PUBLIC_SITE_URL }}
          NOTICE: \${{ secrets.TELEGRAM_BOT_TOKEN }}
`)
}

export function directProject(root) {
  write(root, 'deployment/vars-prod.yml', '$ANSIBLE_VAULT;1.1;AES256\nfixture-ciphertext')
  write(root, 'deployment/deployment-prod.yml', '- hosts: all\n  tasks:\n    - include_vars:\n        file: vars-prod.yml\n')
  write(root, '.github/workflows/ci-prod.yml', `name: Deploy production
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
        env:
          LOGIN: \${{ secrets.DOCKER_USERNAME }}
          PASSWORD: \${{ secrets.DOCKER_PASSWORD }}
  deploy:
    needs: [build]
    runs-on: ubuntu-latest
    steps:
      # - uses: dawidd6/action-ansible-playbook@v2
      #   with:
      #     inventory: \${{ secrets.INVENTORY_PROD_PL }}
      - name: Ukraine
        uses: dawidd6/action-ansible-playbook@v2
        with:
          directory: ./deployment
          playbook: deployment-prod.yml
          key: \${{ secrets.SSH_PRIVATE_KEY_PROD }}
          inventory: \${{ secrets.INVENTORY_PROD_UA }}
          known_hosts: \${{ secrets.KNOWN_HOSTS_PROD_UA }}
          vault_password: \${{ secrets.ANSIBLE_VAULT_PROD }}
      - name: Netherlands
        uses: dawidd6/action-ansible-playbook@v2
        with:
          directory: ./deployment
          playbook: deployment-prod.yml
          key: \${{ secrets.SSH_PRIVATE_KEY_PROD }}
          inventory: \${{ secrets.INVENTORY_PROD_NL }}
          known_hosts: \${{ secrets.KNOWN_HOSTS_PROD_NL }}
          vault_password: \${{ secrets.ANSIBLE_VAULT_PROD }}
`)
}
