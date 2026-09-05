/**
 * USB identities for Vernier interfaces.
 *
 * Every Vernier interface shares vendor ID 0x08F7 and enumerates as a USB HID
 * class device. That HID detail is what makes WebHID the right transport: on
 * Windows a HID device needs no driver replacement and claiming it does not
 * disturb an existing Logger Pro or Graphical Analysis install, whereas WebUSB
 * would need the device rebound to WinUSB. Vernier's own browser build of
 * Graphical Analysis drives a LabQuest Mini over USB in Chrome, so the path is
 * known to work; `webUsbFilters` exists only as a fallback.
 *
 * Two protocol families hide behind the one vendor ID:
 *   - `ngio`  the LabQuest family (LabQuest Mini, LabQuest 2/3, Stream)
 *   - `goio`  the older Go! devices (Go!Link, Go!Motion, Go!Temp)
 * They do not speak the same wire protocol. Only `ngio` is implemented here;
 * `goio` entries are listed so an attached Go! device produces "recognised but
 * unsupported" rather than a blank device picker.
 *
 * Product IDs come from Vernier Technical Information Library article 4289.
 */

export const VERNIER_VENDOR_ID = 0x08f7;

export type VernierProtocolFamily = 'ngio' | 'goio';

export interface VernierDeviceId {
  productId: number;
  name: string;
  family: VernierProtocolFamily;
  /**
   * False for bootloader and viewer modes. They enumerate on the same vendor
   * ID but cannot collect data, so offering them in a picker is a dead end.
   */
  collectsData: boolean;
}

export const VERNIER_DEVICES: readonly VernierDeviceId[] = [
  { productId: 0x0002, name: 'Go!Temp', family: 'goio', collectsData: true },
  { productId: 0x0003, name: 'Go!Link', family: 'goio', collectsData: true },
  { productId: 0x0004, name: 'Go!Motion', family: 'goio', collectsData: true },
  { productId: 0x0005, name: 'LabQuest (original)', family: 'ngio', collectsData: true },
  { productId: 0x0008, name: 'LabQuest Mini', family: 'ngio', collectsData: true },
  { productId: 0x000b, name: 'LabQuest 2', family: 'ngio', collectsData: true },
  { productId: 0x000c, name: 'LabQuest Viewer (USB)', family: 'ngio', collectsData: false },
  { productId: 0x000e, name: 'LabQuest Stream', family: 'ngio', collectsData: true },
  { productId: 0x0013, name: 'Go!Link (bootloader)', family: 'goio', collectsData: false },
  { productId: 0x0015, name: 'LabQuest 3', family: 'ngio', collectsData: true },
  { productId: 0x0016, name: 'LabQuest 3 (internal DAQ)', family: 'ngio', collectsData: true },
  { productId: 0x0017, name: 'LabQuest 3 (bootloader)', family: 'ngio', collectsData: false },
  { productId: 0x0018, name: 'Go!Temp rev2', family: 'goio', collectsData: true },
];

export const findVernierDevice = (productId: number): VernierDeviceId | null =>
  VERNIER_DEVICES.find((device) => device.productId === productId) ?? null;

/** True when we both recognise the device and speak its protocol. */
export const isSupportedVernierDevice = (vendorId: number, productId: number): boolean => {
  if (vendorId !== VERNIER_VENDOR_ID) return false;
  const device = findVernierDevice(productId);
  return device !== null && device.family === 'ngio' && device.collectsData;
};

/**
 * Human-readable label for anything on the Vernier vendor ID, including
 * devices we cannot drive. Unknown product IDs keep their hex so a diagnostics
 * paste is still actionable.
 */
export const describeVernierDevice = (vendorId: number, productId: number): string => {
  const hex = `0x${productId.toString(16).padStart(4, '0')}`;
  if (vendorId !== VERNIER_VENDOR_ID) {
    return `Non-Vernier device (0x${vendorId.toString(16).padStart(4, '0')}:${hex})`;
  }
  const device = findVernierDevice(productId);
  return device ? device.name : `Unknown Vernier device (${hex})`;
};

/**
 * Filters for `navigator.hid.requestDevice`. Deliberately vendor-wide rather
 * than per-product: an unrecognised Vernier interface should still reach the
 * picker so the diagnostics panel can report what it is, instead of the user
 * seeing an empty dialog and concluding the cable is broken.
 */
export const webHidFilters = () => [{ vendorId: VERNIER_VENDOR_ID }];

export const webUsbFilters = () => [{ vendorId: VERNIER_VENDOR_ID }];
