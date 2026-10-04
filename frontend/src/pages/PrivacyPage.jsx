import { Alert, Container, Link, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { publicPages } from "../api/endpoints.js";
import { ErrorAlert, Loading } from "../components/common.jsx";

const H = ({ children }) => <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1 }}>{children}</Typography>;
const P = ({ children }) => <Typography sx={{ mb: 1 }}>{children}</Typography>;

/**
 * Plain-language privacy notice for visitors to a landing page. It describes what this system actually does today; if the
 * system changes (cookies, analytics, automatic deletion), this text must change with it. It is a template, not legal advice.
 */
export default function PrivacyPage() {
  const q = useQuery({ queryKey: ["privacy-contact"], queryFn: publicPages.privacy, staleTime: 5 * 60 * 1000 });
  if (q.isPending) return <Loading />;
  if (q.error) return <Container maxWidth="sm" sx={{ py: 6 }}><ErrorAlert error={q.error} onRetry={q.refetch} /></Container>;
  const { operatorName, contactEmail, configured } = q.data;
  const who = operatorName ?? "the site operator";
  const mail = contactEmail ? <Link href={`mailto:${contactEmail}`}>{contactEmail}</Link> : "the contact address given where you signed up";

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 2 }}>Privacy notice</Typography>
      {!configured && <Alert severity="warning" sx={{ mb: 2 }}>This notice is incomplete: the organisation responsible and its contact address have not been set.</Alert>}

      <H>Who is responsible</H>
      <P>{who} decides how the details you give on this page are used. Contact: {mail}.</P>

      <H>What we collect</H>
      <P>Only what you choose to enter: your name and email address, and, if you add them, your phone number, company, sector and message. We also record which page you signed up on, the tag in the link you followed if it had one (for example where it was shared), and the time you agreed to this notice.</P>
      <P>We also count visits to the page. That count has no cookies and no visitor identity: we do not store your IP address, your browser details or any ID for it. Your browser keeps a small marker for the length of the tab session so a visit is counted once; it is not a cookie and is not sent anywhere else.</P>
      <P>To limit abuse, the server briefly holds your IP address in memory to count how often it is used. It is not written to our records.</P>

      <H>Why, and on what basis</H>
      <P>To contact you about the offer you registered your interest in, and to find out how much interest it gets. We rely on your consent, which you give by ticking the box before you submit. Registering your interest is free and is not a purchase.</P>

      <H>Who sees it</H>
      <P>People working for {who} who deal with these sign-ups. Your details are kept on a server run by our hosting provider, and may be sent by an email service if we write to you. We do not sell them.</P>

      <H>How long we keep it</H>
      <P>Until you ask us to delete it. We do not currently delete details automatically, so please ask if you no longer want us to hold them.</P>

      <H>Your choices</H>
      <P>You can ask us at any time to show you what we hold about you, correct it, or delete it, and you can withdraw your consent. Write to {mail}; deleting your details removes them for good. If you are unhappy with how your details are handled, you can complain to the data protection authority in your country (in Ghana, the Data Protection Commission).</P>

      <H>Changes</H>
      <P>If we change how we use your details, this page changes, and we will ask for your consent again where the law requires it.</P>
    </Container>
  );
}
