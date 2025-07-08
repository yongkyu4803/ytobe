import "@/styles/globals.css";
import type { AppProps } from "next/app";
import "bootstrap/dist/css/bootstrap.min.css";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import("bootstrap").then(() => {
        // Bootstrap 초기화 코드
      });
    }
  }, []);

  return <Component {...pageProps} />;
}
