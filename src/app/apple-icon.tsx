import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            background: "#5b7fb8",
            boxShadow: "0 0 34px 12px rgba(91, 127, 184, 0.45)",
          }}
        />
      </div>
    ),
    size,
  );
}
