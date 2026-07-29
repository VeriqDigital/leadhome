const gmailConnectHref = "/api/gmail/connect";

export function GmailConnectLink({
  reconnect = false,
  className,
  children,
}: {
  reconnect?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={reconnect ? `${gmailConnectHref}?reconnect=1` : gmailConnectHref}
      className={`${className} inline-flex cursor-pointer items-center justify-center`}
    >
      {children}
    </a>
  );
}
