import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { Button } from "@/components/ui/Button";
import styles from "@/components/account/AccountPage.module.css";

export default function OrderNotFound() {
  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Order details"
        title="Order not found"
        description="That order ID isn’t part of your purchase history. Check the ID or return to your purchases."
        action={
          <Button href="/account/purchases" variant="secondary">
            View purchases
          </Button>
        }
      />
    </div>
  );
}
