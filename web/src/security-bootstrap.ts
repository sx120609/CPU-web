import DOMPurify from "dompurify";

type TrustedTypesFactoryLike = {
  createPolicy(name: string, rules: {
    createHTML?: (input: string) => string;
    createScriptURL?: (input: string) => string;
  }): unknown;
};

const trustedTypesFactory = (window as Window & { trustedTypes?: TrustedTypesFactoryLike }).trustedTypes;

if (trustedTypesFactory) {
  try {
    trustedTypesFactory.createPolicy("default", {
      createHTML: (input) => String(DOMPurify.sanitize(input, {
        RETURN_TRUSTED_TYPE: false,
        USE_PROFILES: { html: true },
      })),
      createScriptURL: (input) => {
        const url = new URL(input, window.location.href);
        if (url.origin !== window.location.origin && url.protocol !== "blob:") {
          throw new TypeError("Blocked untrusted script URL");
        }
        return url.href;
      },
    });
  } catch (error) {
    console.error("[security] Trusted Types policy installation failed", error);
  }
}
