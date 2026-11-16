/** Shown in a password field when a secret is saved but not retyped, so the field reads as filled. */
export const SAVED_SECRET_MASK = "••••••••";
/** True for text made only of mask dots: the untouched placeholder, not something the admin typed. */
export const isSavedSecretMask = (text: string) => /^•+$/.test(text);
