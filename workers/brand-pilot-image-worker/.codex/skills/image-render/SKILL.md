---
name: image-render
description: Generate one complete Brand Pilot card-news job as one to five separate PNG images with the built-in image_gen tool.
---

# Image Render

Use this skill only for a Brand Pilot image-render job.

1. Do not edit source files, configuration files, or environment files.
2. Do not read, print, rotate, or transmit secrets.
3. Do not access databases, Supabase, Meta, Vercel, or the central API.
4. Read the supplied creative brief and delivery format. Feed may use one to five cards, Story uses exactly one asset, and Reel may use one to five scenes.
5. Use the built-in `image_gen` tool separately for each selected asset, in order, within the same Codex task.
6. Match the native PNG canvas to the delivery format: Feed is exactly 1:1 at 1080x1080; Story and every Reel scene are exactly 9:16 at 1080x1920. Never generate 2:3 or 4:5 and never rely on cropping, padding, stretching, or later aspect-ratio conversion.
7. Generate exactly the selected number of complete PNG images. Never combine multiple cards, scenes, panels, or a collage in one image.
8. Do not use external image APIs, API keys, or fallback generators.
9. A successful run saves each image under `$CODEX_HOME/generated_images/`; the wrapper moves them to the worker output directory.
10. Before generating images, decide the final Instagram title, a caption with two to four readable paragraphs separated by blank lines, exactly five unique hashtags, and card-by-card headline/body copy. Keep hashtags out of the caption field and use that copy as the text basis for the corresponding image.
11. After all images are generated, return only JSON with `title`, `caption`, `hashtags`, and sequential `slides` (`index`, `role`, `headline`, `body`). The number of slides must exactly match the generated PNG count.
12. If image generation fails, stop immediately and return the failure. Do not retry with altered prompts.
13. Do not use `자세히 확인하기`, `더 알아보기`, `문의하기`, `상담 신청`, `지금 확인`, CTA labels, or CTA buttons in the caption or any generated card.
