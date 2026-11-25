//! The form in which a log line shows an address formatted through `LoggedUrl`. A page's
//! address, or an asset's, can carry a credential in its query (a sign-in token), its fragment
//! or its user info, so that form leaves those parts out, at every level.

use std::fmt;
use url::Url;

/// An address as a log line shows it: its scheme, the host and port of its authority if it has
/// one, and its path. An address with no path to show (a `data:` or `mailto:` address, whose
/// whole text past the scheme is its content) is shown as its scheme and its length. An address
/// that does not parse is shown as a placeholder with its length, since nothing in its text can
/// be told apart from what it would hide.
pub(crate) struct LoggedUrl<'a>(pub(crate) &'a str);

impl fmt::Display for LoggedUrl<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Ok(url) = Url::parse(self.0) else {
            return write!(f, "<unparsable URL, {} bytes>", self.0.len());
        };
        if url.cannot_be_a_base() {
            return write!(f, "{}:<{} bytes>", url.scheme(), self.0.len());
        }
        write!(f, "{}:", url.scheme())?;
        if url.has_authority() {
            write!(f, "//{}", url.host_str().unwrap_or(""))?;
            if let Some(port) = url.port() {
                write!(f, ":{port}")?;
            }
        }
        write!(f, "{}", url.path())
    }
}

#[cfg(test)]
mod tests {
    use super::LoggedUrl;

    #[test]
    fn an_address_is_shown_without_its_user_info_query_or_fragment() {
        let address = "https://person:SECRET@example.com:8443/sign-in/callback?token=SECRET#SECRET";

        assert_eq!(
            LoggedUrl(address).to_string(),
            "https://example.com:8443/sign-in/callback"
        );
    }

    #[test]
    fn an_origin_is_shown_with_its_root_path() {
        assert_eq!(
            LoggedUrl("http://127.0.0.1:8723").to_string(),
            "http://127.0.0.1:8723/"
        );
    }

    #[test]
    fn an_address_without_an_authority_is_shown_without_one() {
        assert_eq!(
            LoggedUrl("unix:/run/socket?token=SECRET").to_string(),
            "unix:/run/socket"
        );
    }

    #[test]
    fn an_address_whose_text_is_its_content_is_shown_as_its_scheme_and_length() {
        let address = "data:text/plain;base64,U0VDUkVU";

        assert_eq!(LoggedUrl(address).to_string(), "data:<31 bytes>");
    }

    #[test]
    fn an_address_that_does_not_parse_is_shown_as_its_length() {
        assert_eq!(
            LoggedUrl("//person:SECRET@example.com/path?token=SECRET").to_string(),
            "<unparsable URL, 45 bytes>"
        );
        assert_eq!(
            LoggedUrl("not an address SECRET").to_string(),
            "<unparsable URL, 21 bytes>"
        );
    }
}
