import { GoogleMerchant } from "./google-merchant";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return <SettingsForm googleMerchant={<GoogleMerchant />} />;
}
