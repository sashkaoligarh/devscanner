export const LANGUAGE_COLORS = {
  TypeScript: '#4488ff',
  JavaScript: '#ffcc00',
  Python: '#44aaff',
  Go: '#66ccff',
  Rust: '#ff7744',
  PHP: '#aa44ff',
  Ruby: '#ff4466',
  Java: '#ff8844',
  Kotlin: '#ff44aa',
  'C#': '#44ffaa'
}

export const FRAMEWORK_COLORS = {
  'Next.js': '#ffffff',
  React: '#61dafb',
  Vue: '#41b883',
  Nuxt: '#00dc82',
  Express: '#68a063',
  NestJS: '#e0234e',
  Vite: '#646cff',
  Strapi: '#4945ff',
  Django: '#44aa66',
  Flask: '#aaaaaa',
  FastAPI: '#009688',
  Laravel: '#ff2d20',
  Rails: '#cc0000',
  'Spring Boot': '#6db33f',
  '.NET': '#512bd4',
  Electron: '#47848f',
  Svelte: '#ff3e00',
  SvelteKit: '#ff3e00',
  Fastify: '#000000'
}

export const FRAMEWORK_PORT_MAP_SIMPLE = {
  'Next.js': 3000, Vite: 5173, Vue: 8080, Nuxt: 8080, Express: 3000,
  NestJS: 3000, Fastify: 3000, React: 3000, Django: 8000, FastAPI: 8000,
  Flask: 5000, 'Spring Boot': 8080, '.NET': 5000, Laravel: 8000, Rails: 3000,
  Strapi: 1337, Astro: 4321
}

export const SERVER_TAG_COLORS = {
  Docker: '#4488ff', PM2: '#aa44ff', nginx: '#00cc66', PHP: '#aa44ff',
  'Node.js': '#ffcc00', MySQL: '#ff8844', PostgreSQL: '#4488ff', Redis: '#ff4444',
  MongoDB: '#00cc66', Apache: '#cc0000', Python: '#44aaff', Go: '#66ccff',
  screen: '#ffcc00'
}

export function makeLogKey(projectPath, instanceId) {
  return `${projectPath}::${instanceId}`
}

export function isWslPath(p) {
  return typeof p === 'string' && /^\\\\wsl/i.test(p)
}
