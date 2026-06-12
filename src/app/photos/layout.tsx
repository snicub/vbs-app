import { ProtectedLayout } from "@/components/protected-layout";

export default async function PhotosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
