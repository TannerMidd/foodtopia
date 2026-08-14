import { beforeEach, describe, expect, it, vi } from "vitest";

import { discoverOpenRouterModels } from "./openrouter-models";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("OpenRouter model discovery", () => {
  it("uses the private user model endpoint and returns only compatible structured-output models", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "vendor/vision-ready",
              name: "Vision Ready",
              context_length: 131072,
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
              supported_parameters: ["structured_outputs", "temperature"],
            },
            {
              id: "vendor/recipe-ready",
              name: "Recipe Ready",
              context_length: 65536,
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              supported_parameters: ["response_format"],
            },
            {
              id: "vendor/no-schema",
              name: "No schema support",
              context_length: 32768,
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
              supported_parameters: ["temperature"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      discoverOpenRouterModels("fake-private-openrouter-key"),
    ).resolves.toMatchObject({
      models: [
        {
          id: "vendor/vision-ready",
          name: "Vision Ready",
          contextLength: 131072,
          supportsVision: true,
        },
        {
          id: "vendor/recipe-ready",
          name: "Recipe Ready",
          contextLength: 65536,
          supportsVision: false,
        },
      ],
      fetchedAt: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models/user",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer fake-private-openrouter-key",
          "X-OpenRouter-Title": "Foodtopia",
        }),
      }),
    );
  });

  it("returns a bounded generic authentication error without provider response data", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "upstream secret detail" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = discoverOpenRouterModels("bad-private-key");
    await expect(result).rejects.toMatchObject({
      code: "OPENROUTER_KEY_INVALID",
      status: 401,
      message: "OpenRouter rejected this API key.",
    });
  });
});
