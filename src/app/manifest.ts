import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "앉을각",
    short_name: "앉을각",
    description: "서울 지하철 좌석각 위치 추천",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f36f21",
    lang: "ko-KR",
    orientation: "portrait"
  };
}
