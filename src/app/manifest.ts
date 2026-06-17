import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "혼자장부",
    short_name: "혼자장부",
    description: "1인법인을 위한 셀프 장부 정리 도구",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#116149",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}
