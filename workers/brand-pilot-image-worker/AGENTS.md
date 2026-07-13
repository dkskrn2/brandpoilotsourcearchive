# Brand Pilot Image Worker

For image-render jobs, use the built-in `image_gen` tool only. Do not call external image APIs or require an `OPENAI_API_KEY`.

Generate one to five separate PNG card files for each claimed job in a single Codex task. The built-in tool writes them under `$CODEX_HOME/generated_images/`. Never combine multiple cards into one image. Do not edit worker code, configuration, credentials, databases, or publishing systems while processing an image-render job.
