import { describe, expect, test } from "bun:test";
import { LyriaInteractionRequest, LyriaInteractionResponse } from "../src/schemas/index.js";

describe("Lyria provider contracts", () => {
  test("accepts the paid soundtrack request without exposing a key", () => {
    expect(
      LyriaInteractionRequest.parse({
        model: "lyria-3-pro-preview",
        input: "Instrumental launch soundtrack",
        store: false,
      }),
    ).toEqual({
      model: "lyria-3-pro-preview",
      input: "Instrumental launch soundtrack",
      store: false,
    });
  });

  test("rejects an empty prompt or retained provider interaction", () => {
    expect(
      LyriaInteractionRequest.safeParse({
        model: "lyria-3-pro-preview",
        input: "",
        store: false,
      }).success,
    ).toBe(false);
    expect(
      LyriaInteractionRequest.safeParse({
        model: "lyria-3-pro-preview",
        input: "Instrumental launch soundtrack",
        store: true,
      }).success,
    ).toBe(false);
  });

  test("accepts audio in either supported Lyria response location", () => {
    expect(
      LyriaInteractionResponse.parse({
        steps: [
          {
            content: [{ type: "audio", data: "YWJj", mime_type: "audio/wav" }],
          },
          {
            model_output: {
              content: [{ type: "audio", data: "ZGVm", mimeType: "audio/mpeg" }],
            },
          },
        ],
      }).steps,
    ).toHaveLength(2);
  });

  test("rejects a response with no steps array or invalid content", () => {
    expect(LyriaInteractionResponse.safeParse({}).success).toBe(false);
    expect(
      LyriaInteractionResponse.safeParse({ steps: [{ content: [{ type: "audio", data: 42 }] }] })
        .success,
    ).toBe(false);
  });
});
