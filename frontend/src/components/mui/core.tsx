import {
  AppBar,
  Avatar as MuiAvatar,
  Box as MuiBox,
  Button as MuiButton,
  Card as MuiCard,
  Checkbox as MuiCheckbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  ListItemButton,
  Menu as MuiMenu,
  MenuItem,
  Paper as MuiPaper,
  Skeleton as MuiSkeleton,
  Stack as MuiStack,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { createContext, isValidElement, useContext, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

type Spacing = number | string | undefined;

const colorMap: Record<string, string> = {
  vector: 'primary',
  green: 'success',
  red: 'error',
  yellow: 'warning',
  cyan: 'info',
  teal: 'success',
  gray: 'default',
  dimmed: 'text.secondary',
};

function mappedColor(color?: string) {
  return color ? (colorMap[color] ?? color) : undefined;
}

function spacing(value: Spacing) {
  return value;
}

function commonSx(props: Record<string, unknown>): SxProps<Theme> {
  const sx: Record<string, unknown> = {};
  if (props.w !== undefined) sx.width = props.w;
  if (props.maw !== undefined) sx.maxWidth = props.maw;
  if (props.h !== undefined) sx.height = props.h;
  if (props.p !== undefined) sx.p = spacing(props.p as Spacing);
  if (props.px !== undefined) sx.px = spacing(props.px as Spacing);
  if (props.py !== undefined) sx.py = spacing(props.py as Spacing);
  if (props.m !== undefined) sx.m = spacing(props.m as Spacing);
  if (props.mt !== undefined) sx.mt = spacing(props.mt as Spacing);
  if (props.mb !== undefined) sx.mb = spacing(props.mb as Spacing);
  if (props.ml !== undefined) sx.ml = spacing(props.ml as Spacing);
  if (props.mr !== undefined) sx.mr = spacing(props.mr as Spacing);
  return sx;
}

export function Box({ component, c, style, sx, ...props }: { component?: React.ElementType; c?: string; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: any }) {
  return <MuiBox component={component ?? 'div'} sx={{ color: mappedColor(c), ...commonSx(props), ...(sx as object) }} style={style} {...props} />;
}

export function Stack({ gap = 'md', align, justify, children, style, sx, ...props }: { gap?: Spacing; align?: string; justify?: string; children?: ReactNode; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiStack spacing={gap === 'xs' ? 0.75 : gap === 'sm' ? 1 : gap === 'md' ? 2 : gap === 'lg' ? 3 : gap === 'xl' ? 4 : gap} alignItems={align} justifyContent={justify} sx={{ ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiStack>
  );
}

export function Group({ gap = 'md', align = 'center', justify, children, style, sx, ...props }: { gap?: Spacing; align?: string; justify?: string; children?: ReactNode; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiStack direction="row" spacing={gap === 'xs' ? 0.75 : gap === 'sm' ? 1 : gap === 'md' ? 2 : gap === 'lg' ? 3 : gap} alignItems={align} justifyContent={justify} sx={{ flexWrap: 'wrap', ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiStack>
  );
}

export function Text({ children, c, fw, fz, size, ta, tt, lineClamp, style, ...props }: { children?: ReactNode; c?: string; fw?: number; fz?: string; size?: string; ta?: CSSProperties['textAlign']; tt?: CSSProperties['textTransform']; lineClamp?: number; style?: CSSProperties; [key: string]: unknown }) {
  return (
    <Typography
      color={mappedColor(c)}
      fontWeight={fw}
      fontSize={fz ?? (size === 'xs' ? '0.75rem' : size === 'sm' ? '0.875rem' : size === 'xl' ? '1.25rem' : undefined)}
      textAlign={ta}
      textTransform={tt}
      sx={{
        ...commonSx(props),
        ...(lineClamp
          ? {
              display: '-webkit-box',
              WebkitLineClamp: lineClamp,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }
          : {}),
      }}
      style={style}
    >
      {children}
    </Typography>
  );
}

export function Title({ order = 2, children, ...props }: { order?: 1 | 2 | 3 | 4 | 5 | 6; children?: ReactNode; [key: string]: unknown }) {
  const variant = order <= 2 ? 'h4' : order === 3 ? 'h5' : order === 4 ? 'h6' : 'subtitle1';
  return (
    <Typography variant={variant} fontWeight={700} sx={commonSx(props)}>
      {children}
    </Typography>
  );
}

export function Button({ leftSection, loading, variant, color, children, size, ...props }: { leftSection?: ReactNode; loading?: boolean; variant?: string; color?: string; children?: ReactNode; size?: string; [key: string]: any }) {
  const muiVariant = variant === 'light' || variant === 'subtle' ? 'outlined' : variant === 'outline' ? 'outlined' : variant === 'filled' || !variant ? 'contained' : variant;
  const muiSize = size === 'xs' ? 'small' : size;
  return (
    <MuiButton variant={muiVariant as 'text' | 'outlined' | 'contained'} color={mappedColor(color) as 'primary'} size={muiSize as 'small' | 'medium' | 'large'} startIcon={leftSection} disabled={loading || props.disabled} {...props}>
      {loading ? <CircularProgress color="inherit" size={18} sx={{ mr: children ? 1 : 0 }} /> : null}
      {children}
    </MuiButton>
  );
}

export function ActionIcon({ children, color, variant: _variant, loading, ...props }: { children?: ReactNode; color?: string; variant?: string; loading?: boolean; [key: string]: unknown }) {
  return (
    <IconButton color={mappedColor(color) as 'primary'} disabled={Boolean(loading || props.disabled)} size="small" {...props}>
      {loading ? <CircularProgress size={18} /> : children}
    </IconButton>
  );
}

export function TextInput({ label, placeholder, required, leftSection, error, value, onChange, ...props }: Record<string, unknown>) {
  return <TextField label={label as string} placeholder={placeholder as string} required={Boolean(required)} error={Boolean(error)} helperText={(error as string) || props.description as string} value={value as string} onChange={onChange as React.ChangeEventHandler<HTMLInputElement>} InputProps={leftSection ? { startAdornment: leftSection as ReactNode } : undefined} fullWidth size="small" {...props} />;
}

export function PasswordInput(props: Record<string, unknown>) {
  return <TextInput type="password" {...props} />;
}

export function Textarea({ minRows = 3, maxRows, autosize: _autosize, ...props }: Record<string, unknown>) {
  return <TextInput multiline minRows={minRows as number} maxRows={maxRows as number} {...props} />;
}

export function Checkbox({ label, checked, onChange, ...props }: Record<string, unknown>) {
  return (
    <MuiBox display="flex" alignItems="center">
      <MuiCheckbox checked={Boolean(checked)} onChange={onChange as React.ChangeEventHandler<HTMLInputElement>} {...props} />
      {label ? <Typography variant="body2">{label as ReactNode}</Typography> : null}
    </MuiBox>
  );
}

export function Anchor({ component, to, href, children, ...props }: { component?: React.ElementType; to?: string; href?: string; children?: ReactNode; [key: string]: unknown }) {
  const linkProps = component ? { component, to } : { href };
  return (
    <MuiLink {...linkProps} {...props}>
      {children}
    </MuiLink>
  );
}

export function Paper({ children, withBorder, padding, p, style, sx, ...props }: { children?: ReactNode; withBorder?: boolean; padding?: Spacing; p?: Spacing; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiPaper sx={{ p: padding ?? p, border: withBorder ? '1px solid rgba(0,0,0,0.12)' : undefined, ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiPaper>
  );
}

export function Card({ children, withBorder, padding, p, style, sx, ...props }: { children?: ReactNode; withBorder?: boolean; padding?: Spacing; p?: Spacing; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiCard sx={{ p: padding ?? p, border: withBorder ? '1px solid rgba(0,0,0,0.12)' : undefined, ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiCard>
  );
}

export function Badge({ children, color, variant: _variant, ...props }: { children?: ReactNode; color?: string; variant?: string; [key: string]: unknown }) {
  return <Chip color={mappedColor(color) as 'primary'} label={children} size="small" variant="outlined" {...props} />;
}

export function Progress({ value, color, ...props }: { value?: number; color?: string; [key: string]: unknown }) {
  return <LinearProgress variant="determinate" value={value ?? 0} color={mappedColor(color) as 'primary'} sx={{ width: '100%', borderRadius: 999, ...commonSx(props) }} />;
}

export function RingProgress({ value, label, sections, size = 120 }: { value?: number; label?: ReactNode; sections?: Array<{ value: number; color?: string }>; size?: number; roundCaps?: boolean; thickness?: number }) {
  const computed = value ?? sections?.[0]?.value ?? 0;
  return (
    <MuiBox position="relative" display="inline-flex">
      <CircularProgress variant="determinate" value={computed} size={size} thickness={4} />
      <MuiBox position="absolute" sx={{ inset: 0 }} display="flex" alignItems="center" justifyContent="center">
        {label}
      </MuiBox>
    </MuiBox>
  );
}

export function SimpleGrid({ cols = 1, children }: { cols?: number | Record<string, number>; children?: ReactNode }) {
  const desktopCols = typeof cols === 'number' ? cols : cols.md ?? cols.xs ?? cols.base ?? 1;
  return <MuiBox display="grid" gridTemplateColumns={{ xs: '1fr', sm: `repeat(${Math.min(desktopCols, 2)}, 1fr)`, md: `repeat(${desktopCols}, 1fr)` }} gap={2}>{children}</MuiBox>;
}

function GridRoot({ children }: { children?: ReactNode }) {
  return <MuiBox display="grid" gridTemplateColumns="repeat(12, 1fr)" gap={2}>{children}</MuiBox>;
}

function GridCol({ span = 12, children }: { span?: number | Record<string, number>; children?: ReactNode }) {
  const md = typeof span === 'number' ? span : span.md ?? span.base ?? 12;
  return <MuiBox gridColumn={{ xs: 'span 12', md: `span ${md}` }}>{children}</MuiBox>;
}

export const Grid = Object.assign(GridRoot, { Col: GridCol });

export function Skeleton(props: Record<string, unknown>) {
  return <MuiSkeleton variant="rounded" {...props} />;
}

export function ThemeIcon({ children, color, ...props }: { children?: ReactNode; color?: string; [key: string]: any }) {
  return (
    <MuiBox color={`${mappedColor(color)}.main`} display="inline-flex" alignItems="center" justifyContent="center" bgcolor="action.hover" borderRadius={1} p={1} {...props}>
      {children}
    </MuiBox>
  );
}

export function Modal({ opened, onClose, title, children, size: _size }: { opened: boolean; onClose: () => void; title?: ReactNode; children?: ReactNode; size?: string; centered?: boolean }) {
  return (
    <Dialog open={opened} onClose={onClose} fullWidth maxWidth="md">
      {title ? <DialogTitle>{title}</DialogTitle> : null}
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}

export function Code({ children, block, style }: { children?: ReactNode; block?: boolean; style?: CSSProperties }) {
  return (
    <MuiBox component="code" display={block ? 'block' : 'inline'} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', bgcolor: 'action.hover', borderRadius: 1, p: block ? 1.5 : 0.25, fontFamily: 'monospace' }} style={style}>
      {children}
    </MuiBox>
  );
}

export function ScrollArea({ children, h, p, flex }: { children?: ReactNode; h?: Spacing; p?: Spacing; flex?: number }) {
  return <MuiBox sx={{ maxHeight: h, overflow: 'auto', p, flex }}>{children}</MuiBox>;
}

export function Center({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return <MuiBox display="flex" alignItems="center" justifyContent="center" style={style}>{children}</MuiBox>;
}

export function Loader(props: { size?: string | number; color?: string; type?: string }) {
  return <CircularProgress size={props.size === 'lg' ? 36 : props.size} color={mappedColor(props.color) as 'primary'} />;
}

export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement; position?: string; withArrow?: boolean }) {
  return <MuiTooltip title={label}>{children}</MuiTooltip>;
}

export function Avatar(props: Record<string, unknown>) {
  return <MuiAvatar {...props} />;
}

export function Burger({ opened: _opened, ...props }: Record<string, unknown>) {
  return (
    <IconButton {...props}>
      <MenuIcon />
    </IconButton>
  );
}

export function UnstyledButton({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
  return <MuiBox component="button" sx={{ border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer' }} {...props}>{children}</MuiBox>;
}

const MenuContext = createContext<{ anchorEl: HTMLElement | null; setAnchorEl: (el: HTMLElement | null) => void } | null>(null);

function MenuRoot({ children }: { children?: ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return <MenuContext.Provider value={{ anchorEl, setAnchorEl }}>{children}</MenuContext.Provider>;
}

function MenuTarget({ children }: { children: ReactElement }) {
  const ctx = useContext(MenuContext);
  if (!ctx || !isValidElement(children)) return children;
  return (
    <span onClick={(event) => ctx.setAnchorEl(event.currentTarget)}>
      {children}
    </span>
  );
}

function MenuDropdown({ children }: { children?: ReactNode }) {
  const ctx = useContext(MenuContext);
  return (
    <MuiMenu anchorEl={ctx?.anchorEl ?? null} open={Boolean(ctx?.anchorEl)} onClose={() => ctx?.setAnchorEl(null)}>
      {children}
    </MuiMenu>
  );
}

function MenuItemCompat({ children, leftSection, color, onClick }: { children?: ReactNode; leftSection?: ReactNode; color?: string; onClick?: () => void }) {
  const ctx = useContext(MenuContext);
  return (
    <MenuItem
      onClick={() => {
        onClick?.();
        ctx?.setAnchorEl(null);
      }}
      sx={{ color: color === 'red' ? 'error.main' : undefined }}
    >
      {leftSection}
      <MuiBox component="span" ml={leftSection ? 1 : 0}>{children}</MuiBox>
    </MenuItem>
  );
}

export const Menu = Object.assign(MenuRoot, { Target: MenuTarget, Dropdown: MenuDropdown, Item: MenuItemCompat, Divider });

export function NavLink({ component: Component = RouterLink, to, label, leftSection, active, ...props }: { component?: React.ElementType; to?: string; label?: ReactNode; leftSection?: ReactNode; active?: boolean; [key: string]: unknown }) {
  return (
    <ListItemButton component={Component} to={to} selected={active} {...props}>
      {leftSection ? <MuiBox mr={1} display="inline-flex">{leftSection}</MuiBox> : null}
      {label}
    </ListItemButton>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

AppShell.Header = AppBar;
AppShell.Navbar = Drawer;
AppShell.Main = MuiBox;

export function rem(value: number) {
  return `${value / 16}rem`;
}
