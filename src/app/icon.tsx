import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// The app's mark is the bowl, not a letter: terracotta, with something in it.
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
          background: "#171310",
        }}
      >
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: 999,
            background: "#d2734a",
            overflow: "hidden",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 62,
              width: 96,
              height: 96,
              borderRadius: 999,
              background: "#f2eae0",
              display: "flex",
            }}
          />
          <div
            style={{
              width: 170,
              height: 62,
              borderRadius: "62px 62px 0 0",
              background: "#8c9e7e",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
