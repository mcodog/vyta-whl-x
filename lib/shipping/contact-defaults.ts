/**
 * Default recipient contact used when a shipment's destination has no email or
 * phone on file. Couriers/Easyship still need *some* contact, so rather than
 * blocking label creation we fall back to these house defaults — the same ones
 * the client-shipment (Packing List) flow already uses. Email and phone are
 * therefore optional on any shipment.
 *
 * Kept in a dependency-free module so both the shipping lib and the admin
 * helpers can import it without pulling in email/PDF code.
 */
export const DEFAULT_CLIENT_EMAIL = "aminoship@proton.me";
export const DEFAULT_CLIENT_PHONE = "16473029495";
