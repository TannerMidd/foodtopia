import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

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
          borderRadius: 108,
          background: "#235943",
          color: "#fffdf8",
          fontFamily: "sans-serif",
          fontSize: 278,
          fontWeight: 800,
          letterSpacing: -28,
          paddingRight: 24,
        }}
      >
        F
      </div>
    ),
    size,
  );
}
