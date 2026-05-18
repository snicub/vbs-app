import { ProtectedLayout } from "@/components/protected-layout";

export default function TableLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
