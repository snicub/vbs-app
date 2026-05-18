import { ProtectedLayout } from "@/components/protected-layout";

export default function VanLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
