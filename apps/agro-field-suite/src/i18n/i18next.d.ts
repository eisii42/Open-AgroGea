import "i18next";

import type en from "./locales/en.json";

// Tipa le chiavi di `t()` contro il catalog inglese: chiavi mancanti o errate
// diventano errori di compilazione. `en.json` è la fonte di verità; gli altri
// cataloghi possono essere parziali e ricadono su di esso a runtime.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
    };
  }
}
