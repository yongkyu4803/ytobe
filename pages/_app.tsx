import "@/styles/globals.css";
import type { AppProps } from "next/app";
import "bootstrap/dist/css/bootstrap.min.css";
import { useEffect } from "react";
import "bootstrap";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Bootstrap JS를 동적으로 로드
    import("bootstrap").then(() => {
      // Bootstrap 초기화 코드
    });
  }, []);

  return <Component {...pageProps} />;
}
