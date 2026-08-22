import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// The app's mark is the lamp, not a letter: one lit square on warm charcoal.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#181715",
          border: "6px solid #2b2a26",
          borderRadius: 108,
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 20,
            background: "#5b7fb8",
            boxShadow: "0 0 96px 32px rgba(91, 127, 184, 0.45)",
          }}
        />
      </div>
    ),
    size,
  );
}
