import { GoogleMerchant } from "./google-merchant";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return (
    <s-page heading="Settings">
      <s-stack gap="base">
        <SettingsForm />
        <GoogleMerchant />
      </s-stack>
    </s-page>
  );
}
