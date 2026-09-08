import { ImageResponse } from "next/og";

// The card that renders when someone shares an AdmitFlow link — in WhatsApp, on LinkedIn,
// in a group chat between students. Without it, a shared link previews as a bare URL,
// which reads as a broken or untrustworthy site at exactly the moment someone is
// recommending the product to someone else.
//
// Generated rather than shipped as a PNG so the wording and the brand colours stay in one
// place with the rest of the code, and cannot drift from the palette.

export const alt = "AdmitFlow — Say No to Consultants. Apply Abroad Yourself.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #2F8449 0%, #0A2540 62%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "rgba(255,255,255,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "30px",
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ fontSize: "34px", fontWeight: 600, letterSpacing: "-0.01em" }}>
            AdmitFlow
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: "68px",
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              maxWidth: "900px",
            }}
          >
            Say No to Consultants.
          </div>
          <div
            style={{
              fontSize: "68px",
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              color: "#8ECBA5",
            }}
          >
            Apply Abroad Yourself.
          </div>
          <div
            style={{
              marginTop: "26px",
              fontSize: "27px",
              color: "rgba(255,255,255,0.72)",
              maxWidth: "820px",
              lineHeight: 1.4,
            }}
          >
            See which universities actually fit your profile, and why — then apply
            directly, without an agency taking a cut.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: "22px", color: "rgba(255,255,255,0.55)" }}>
          by SNZ Ventures
        </div>
      </div>
    ),
    size,
  );
}
