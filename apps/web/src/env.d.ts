/// <reference types="next" />
/// <reference types="next/image-types/global" />

declare namespace NodeJS {
  interface ProcessEnv {
    /** Port for the web server */
    PORT?: string;

    /** Public API URL — used in browser (goes through Nginx) */
    NEXT_PUBLIC_API_URL?: string;

    /** Internal API URL — used for SSR (direct container-to-container) */
    API_INTERNAL_URL?: string;

    /** Default locale */
    NEXT_PUBLIC_DEFAULT_LOCALE?: string;

    /** Comma-separated supported locales */
    NEXT_PUBLIC_SUPPORTED_LOCALES?: string;
  }
}
