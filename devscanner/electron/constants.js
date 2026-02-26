const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs',
  '.php', '.rb', '.java', '.kt', '.cs'
])

const EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '__pycache__',
  'venv', '.venv', 'env', '.env', '.tox', '.mypy_cache', '.pytest_cache',
  'target', '.next', '.nuxt', 'coverage', '.cache'
])

const FRAMEWORK_PORT_MAP = {
  'Next.js': 3000,
  'Vite': 5173,
  'Vue': 8080,
  'Nuxt': 8080,
  'Strapi': 1337,
  'Express': 3000,
  'NestJS': 3000,
  'Fastify': 3000,
  'Rails': 3000,
  'React': 3000,
  'Django': 8000,
  'FastAPI': 8000,
  'Flask': 5000,
  'Spring Boot': 8080,
  '.NET': 5000,
  'Laravel': 8000
}

const LANGUAGE_PORT_MAP = {
  'Go': 8080,
  'Java': 8080,
  'Kotlin': 8080,
  'PHP': 8000,
  'C#': 5000
}

const COMMON_DEV_PORTS = [
  80, 443, 1337, 3000, 3001, 3002, 3003, 3333, 4000, 4200, 4321, 4433,
  5000, 5001, 5050, 5173, 5174, 5500, 5555, 6006, 6379, 8000, 8001,
  8080, 8081, 8443, 8888, 9000, 9090, 9229, 19006, 24678, 27017
]

const MANIFEST_FILES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py',
  'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile',
  'pom.xml', 'build.gradle', 'build.gradle.kts'
]

module.exports = {
  SOURCE_EXTENSIONS,
  EXCLUDED_DIRS,
  FRAMEWORK_PORT_MAP,
  LANGUAGE_PORT_MAP,
  COMMON_DEV_PORTS,
  MANIFEST_FILES
}
