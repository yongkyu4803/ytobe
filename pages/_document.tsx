import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="ko">
      <Head>
        <link rel="preload" href="/fonts/KIMM_Light.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="icon" href="/brand/gq-icon.svg" type="image/svg+xml" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
