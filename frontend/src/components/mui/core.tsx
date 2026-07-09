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
import { alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import { createContext, isValidElement, useContext, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

type Spacing = number | string | undefined;

const spacingMap: Record<string, number> = {
  xs: 0.5,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
};

const radiusMap: Record<string, string | number> = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
};

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
  if (typeof value === 'string' && value in spacingMap) {
    return spacingMap[value];
  }
  if (typeof value === 'number') {
    return `${value}px`;
  }
  return value;
}

function commonSx(props: Record<string, unknown>): Record<string, any> {
  const sx: Record<string, unknown> = {};
  if (props.w !== undefined) sx.width = typeof props.w === 'number' ? `${props.w}px` : props.w;
  if (props.maw !== undefined) sx.maxWidth = typeof props.maw === 'number' ? `${props.maw}px` : props.maw;
  if (props.h !== undefined) sx.height = typeof props.h === 'number' ? `${props.h}px` : props.h;
  if (props.p !== undefined) sx.p = spacing(props.p as Spacing);
  if (props.px !== undefined) sx.px = spacing(props.px as Spacing);
  if (props.py !== undefined) sx.py = spacing(props.py as Spacing);
  if (props.m !== undefined) sx.m = spacing(props.m as Spacing);
  if (props.mt !== undefined) sx.mt = spacing(props.mt as Spacing);
  if (props.mb !== undefined) sx.mb = spacing(props.mb as Spacing);
  if (props.ml !== undefined) sx.ml = spacing(props.ml as Spacing);
  if (props.mr !== undefined) sx.mr = spacing(props.mr as Spacing);
  
  if (props.radius !== undefined) {
    const r = props.radius as string | number;
    sx.borderRadius = typeof r === 'string' && r in radiusMap ? radiusMap[r] : r;
  }
  return sx;
}

export function Box({ component, c, style, sx, ...props }: { component?: React.ElementType; c?: string; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: any }) {
  return <MuiBox component={component ?? 'div'} sx={{ color: mappedColor(c), ...commonSx(props), ...(sx as object) }} style={style} {...props} />;
}

export function Stack({ gap = 'md', align, justify, children, style, sx, ...props }: { gap?: Spacing; align?: string; justify?: string; children?: ReactNode; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiStack spacing={spacing(gap)} alignItems={align} justifyContent={justify} sx={{ ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiStack>
  );
}

export function Group({ gap = 'md', align = 'center', justify, children, style, sx, ...props }: { gap?: Spacing; align?: string; justify?: string; children?: ReactNode; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiStack direction="row" spacing={spacing(gap)} alignItems={align} justifyContent={justify} sx={{ flexWrap: 'wrap', ...commonSx(props), ...(sx as object) }} style={style}>
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
  const variant = order === 1 ? 'h4' : order === 2 ? 'h5' : order === 3 ? 'h6' : order === 4 ? 'subtitle1' : 'subtitle2';
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
    <MuiPaper sx={{ p: spacing(padding ?? p), border: withBorder ? '1px solid rgba(0,0,0,0.12)' : undefined, ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiPaper>
  );
}

export function Card({ children, withBorder, padding, p, style, sx, ...props }: { children?: ReactNode; withBorder?: boolean; padding?: Spacing; p?: Spacing; style?: CSSProperties; sx?: SxProps<Theme>; [key: string]: unknown }) {
  return (
    <MuiCard sx={{ p: spacing(padding ?? p), border: withBorder ? '1px solid rgba(0,0,0,0.12)' : undefined, ...commonSx(props), ...(sx as object) }} style={style}>
      {children}
    </MuiCard>
  );
}

export function Badge({ children, color, variant = 'light', size, ...props }: { children?: ReactNode; color?: string; variant?: string; size?: string; [key: string]: unknown }) {
  const mColor = mappedColor(color) as 'primary' | 'success' | 'warning' | 'error' | 'info' | 'default';
  const isSmall = size === 'xs' || size === 'sm';
  
  return (
    <Chip
      label={children}
      size={isSmall ? 'small' : 'medium'}
      sx={(theme) => {
        const hasColor = mColor && mColor !== 'default';
        const pal = theme.palette as any;
        if (variant === 'light' && hasColor && pal[mColor]) {
          const mainColor = pal[mColor].main;
          return {
            color: mainColor,
            bgcolor: alpha(mainColor, 0.12),
            border: 'none',
            fontWeight: 700,
            fontSize: isSmall ? '10px' : '12px',
            height: isSmall ? '18px' : '24px',
            '& .MuiChip-label': {
              px: 1.2,
            }
          };
        }
        return {
          fontWeight: 600,
          fontSize: isSmall ? '10px' : '12px',
          height: isSmall ? '18px' : '24px',
          ...commonSx(props),
        };
      }}
      {...props}
    />
  );
}

export function Progress({ value, color, ...props }: { value?: number; color?: string; [key: string]: unknown }) {
  return <LinearProgress variant="determinate" value={value ?? 0} color={mappedColor(color) as 'primary'} sx={{ width: '100%', borderRadius: 999, ...commonSx(props) }} />;
}

export function RingProgress({ value, label, sections, size = 120, thickness = 4 }: { value?: number; label?: ReactNode; sections?: Array<{ value: number; color?: string }>; size?: number; roundCaps?: boolean; thickness?: number }) {
  if (sections && sections.length > 0) {
    return (
      <MuiBox position="relative" display="inline-flex" style={{ width: size, height: size }}>
        {/* Render a background track */}
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={thickness}
          sx={{ color: 'action.hover' }}
        />
        {/* Render each section stacked */}
        {sections.map((section, index) => {
          let rotation = -90; // Start at top
          let accumulatedValue = 0;
          for (let i = 0; i < index; i++) {
            accumulatedValue += sections[i].value;
          }
          rotation += (accumulatedValue / 100) * 360;
          
          return (
            <CircularProgress
              key={index}
              variant="determinate"
              value={section.value}
              size={size}
              thickness={thickness}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `rotate(${rotation}deg)`,
                color: section.color,
              }}
            />
          );
        })}
        <MuiBox position="absolute" sx={{ inset: 0 }} display="flex" alignItems="center" justifyContent="center">
          {label}
        </MuiBox>
      </MuiBox>
    );
  }

  const computed = value ?? 0;
  return (
    <MuiBox position="relative" display="inline-flex" style={{ width: size, height: size }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={thickness}
        sx={{ color: 'action.hover' }}
      />
      <CircularProgress
        variant="determinate"
        value={computed}
        size={size}
        thickness={thickness}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
        }}
      />
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
  const mColor = mappedColor(color);
  return (
    <MuiBox
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      sx={(theme) => ({
        color: mColor ? `${mColor}.main` : 'text.primary',
        bgcolor: mColor 
          ? alpha((theme.palette as any)[mColor]?.main ?? theme.palette.primary.main, 0.12)
          : 'action.hover',
        borderRadius: '8px',
        p: 1,
        ...commonSx(props),
      })}
    >
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
    <ListItemButton 
      component={Component} 
      to={to} 
      selected={active} 
      sx={{
        py: 1,
        px: 2,
        borderRadius: '8px',
        mb: 0.5,
        '&.Mui-selected': {
          bgcolor: 'primary.light',
          color: 'primary.contrastText',
          '&:hover': {
            bgcolor: 'primary.light',
          },
          '& .MuiBox-root': {
            color: 'inherit',
          }
        },
      }}
      {...props}
    >
      {leftSection ? <MuiBox mr={1.5} display="inline-flex" alignItems="center">{leftSection}</MuiBox> : null}
      <MuiBox sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', width: '100%' }}>
        {label}
      </MuiBox>
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
