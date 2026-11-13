import { expect, test } from "@playwright/test";

test("оптимизатор изображений отклоняет SVG и обрабатывает PNG", async ({
  request,
}) => {
  const svgResponse = await request.get(
    "/_next/image?url=%2Fbrand%2Flogo-mark.svg&w=640&q=75",
  );

  expect(svgResponse.status()).toBe(400);

  const pngResponse = await request.get(
    "/_next/image?url=%2Fimages%2Fcourse-cover-abstract.png&w=640&q=75",
  );

  expect(pngResponse.status()).toBe(200);
  expect(pngResponse.headers()["content-type"]).toMatch(/^image\//);
  expect((await pngResponse.body()).byteLength).toBeGreaterThan(0);
});
