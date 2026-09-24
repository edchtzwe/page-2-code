# Web

React Native client application for page-2-code, styled with NativeWind.

## Stack

| Package | Version |
| :--- | :--- |
| react-native | 0.87.1 |
| react | 19.3.0 |
| nativewind | 4.2.7 |
| tailwindcss | 4.3.3 |

NativeWind is the styling layer. Tailwind CSS utility classes compile to React Native styles, which keeps the client aligned with the Tailwind output the API can generate from an accepted preview. Whether the app is created through the Expo workflow or bare React Native is not decided yet.

## Responsibilities

- Let the user select a screenshot or an MP4 recording.
- Upload the selection to the API.
- Render the staged HTML preview for accept or reject.
- Present the generated React codebase.

## Development container

The web container starts Bash and mounts the complete repository at `/app`.

```bash
podman exec -it page-2-code-web bash
```

## Status

Frontend implementation is intentionally deferred while the backend foundation is built.
