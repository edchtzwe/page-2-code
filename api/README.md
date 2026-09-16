# API

NestJS and TypeScript backend for page-2-code.

## Responsibilities

- Receive screenshot and MP4 uploads.
- Coordinate analysis and staged generation.
- Store workflow data in PostgreSQL through Prisma.
- Use Google AI Studio through `@google/genai`.
- Use OpenRouter through the OpenAI SDK.
- Connect to the dedicated MCP service over HTTP.

## Dependencies

`package.json` defines the initial dependencies. Install them from the API container:

```bash
npm install
```

## Prisma

PostgreSQL is available inside the Podman pod at `localhost:5432`. Configure `DATABASE_URL` before using Prisma.

```bash
export DATABASE_URL='postgresql://page_2_code:page_2_code_dev@localhost:5432/page_2_code?schema=public'
npx prisma init
npx prisma generate
```

## AI credentials

```bash
export GOOGLE_API_KEY='replace-me'
export OPENROUTER_API_KEY='replace-me'
```

## Development

```bash
npm run start:dev
```
