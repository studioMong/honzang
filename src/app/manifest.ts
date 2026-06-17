import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "혼자장부",
    short_name: "혼자장부",
    description: "1인법인을 위한 셀프 장부 정리 도구",
    start_url: "/",
    scope: "/",
    lang: "ko",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f6f8",
    theme_color: "#116149",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "CSV 업로드",
        short_name: "업로드",
        description: "통장, 카드, 홈택스 CSV 업로드",
        url: "/?view=imports",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
      },
      {
        name: "리포트",
        short_name: "리포트",
        description: "손익, 부가세, 법인세 준비 리포트",
        url: "/?view=reports",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
      }
    ]
  };
}
