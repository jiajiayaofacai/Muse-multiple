//! Dependency-free validation, also runnable with `rustc --test logic.rs`.

pub(crate) fn account_name(input: &str) -> Result<String, &'static str> {
    let name = input.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("账号名称须为 1–80 个字符，且不能含控制字符");
    }
    Ok(name.to_owned())
}

pub(crate) fn canonical_id(input: &str) -> bool {
    let bytes = input.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(c)
            }
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

pub(crate) fn owned_tab(account: &str, owner: &str, tab: &str) -> bool {
    canonical_id(account) && canonical_id(tab) && account == owner
}

// This is a conservative preflight. Native callers additionally parse with tauri::Url.
pub(crate) fn allowed_url(input: &str) -> bool {
    if input.len() > 16384
        || input
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return false;
    }
    if input == "about:blank" {
        return true;
    }
    let lower = input.to_ascii_lowercase();
    if ["%00", "%0a", "%0d"].iter().any(|s| lower.contains(s)) {
        return false;
    }
    let Some((scheme, rest)) = input.split_once("://") else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    !authority.is_empty() && !authority.contains('@') && !authority.contains('%')
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LayoutStep<'a> {
    SetActiveBounds(&'a str),
    ShowActive(&'a str),
    Hide(&'a str),
}

pub(crate) fn layout_steps<'a>(
    tabs: &'a [String],
    active: Option<&'a str>,
) -> impl Iterator<Item = LayoutStep<'a>> {
    let active = active.filter(|active| tabs.iter().any(|tab| tab == active));
    active
        .into_iter()
        .flat_map(|active| {
            [
                LayoutStep::SetActiveBounds(active),
                LayoutStep::ShowActive(active),
            ]
        })
        .chain(inactive_tabs(tabs, active).map(LayoutStep::Hide))
}

pub(crate) fn inactive_tabs<'a>(
    tabs: &'a [String],
    active: Option<&str>,
) -> impl Iterator<Item = &'a str> {
    tabs.iter()
        .filter(move |id| Some(id.as_str()) != active)
        .map(String::as_str)
}

pub(crate) fn valid_bounds(
    values: [f64; 4],
    window: [f64; 2],
    seq: u64,
    previous: Option<u64>,
) -> bool {
    let [x, y, width, height] = values;
    values
        .iter()
        .chain(window.iter())
        .all(|v| v.is_finite() && *v >= 0.)
        && previous.is_none_or(|old| seq > old)
        && seq <= 9_007_199_254_740_991
        && x + width <= window[0]
        && y + height <= window[1]
}

#[cfg(test)]
mod tests {
    use super::*;
    const A: &str = "6ee7080e-e0ba-4a70-bd01-df306c2d351f";
    const B: &str = "194b5aa2-c1f4-45c3-9e00-ab0637999e4e";

    #[test]
    fn name_trim_and_unicode() {
        assert_eq!(account_name("  工作账号 A  "), Ok("工作账号 A".into()));
        assert!(account_name("").is_err());
        assert!(account_name(" \t ").is_err());
        assert!(account_name("a\nb").is_err());
        assert!(account_name(&"字".repeat(81)).is_err());
    }

    #[test]
    fn ids_are_canonical_and_ownership_is_checked() {
        assert!(canonical_id(A));
        assert!(!canonical_id("../../profile"));
        assert!(!canonical_id(&A.to_uppercase()));
        assert!(!canonical_id("00000000-0000-0000-0000-000000000000"));
        assert!(owned_tab(A, A, B));
        assert!(!owned_tab(A, B, A));
        assert!(!owned_tab(A, A, "../tab"));
    }

    #[test]
    fn navigation_allows_only_explicit_safe_schemes() {
        for url in [
            "https://muse.ai/",
            "http://127.0.0.1:4311/auth?synthetic=1#x",
            "about:blank",
            "https://[::1]:4311/",
        ] {
            assert!(allowed_url(url), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///C:/test",
            "data:text/html,hi",
            "about:config",
            "about:blank?x=1",
            "https://user:secret@muse.ai/",
            "https://@muse.ai/",
            "https:///muse.ai",
            "https://muse.ai\\@evil.test/",
            "https://muse.ai/\n",
            "//muse.ai/",
            "https://",
            " https://muse.ai/",
            "https://muse.ai/%0a",
        ] {
            assert!(!allowed_url(url), "{url}");
        }
    }

    #[test]
    fn layout_sets_active_bounds_and_shows_it_before_hiding_siblings() {
        let tabs = vec![A.to_owned(), B.to_owned()];
        assert_eq!(
            layout_steps(&tabs, Some(B)).collect::<Vec<_>>(),
            vec![
                LayoutStep::SetActiveBounds(B),
                LayoutStep::ShowActive(B),
                LayoutStep::Hide(A),
            ]
        );
        assert_eq!(
            layout_steps(&tabs, None).collect::<Vec<_>>(),
            vec![LayoutStep::Hide(A), LayoutStep::Hide(B)]
        );
        assert_eq!(
            layout_steps(&tabs, Some("missing")).collect::<Vec<_>>(),
            vec![LayoutStep::Hide(A), LayoutStep::Hide(B)]
        );
    }

    #[test]
    fn layout_rejects_nonfinite_negative_stale_and_outside_window() {
        assert!(valid_bounds(
            [200., 100., 800., 600.],
            [1280., 850.],
            1,
            None
        ));
        assert!(valid_bounds([0., 0., 0., 0.], [1280., 850.], 2, Some(1)));
        assert!(!valid_bounds(
            [f64::NAN, 0., 1., 1.],
            [1280., 850.],
            2,
            Some(1)
        ));
        assert!(!valid_bounds(
            [0., 0., f64::INFINITY, 1.],
            [1280., 850.],
            2,
            Some(1)
        ));
        assert!(!valid_bounds([-1., 0., 1., 1.], [1280., 850.], 2, Some(1)));
        assert!(!valid_bounds(
            [1200., 0., 100., 1.],
            [1280., 850.],
            2,
            Some(1)
        ));
        assert!(!valid_bounds([0., 0., 1., 1.], [1280., 850.], 1, Some(1)));
        assert!(!valid_bounds([0., 0., 1., 1.], [1280., 850.], 0, Some(1)));
        assert!(!valid_bounds(
            [0., 0., 1., 1.],
            [f64::NAN, 850.],
            2,
            Some(1)
        ));
    }
}
