import AddIcon from '@mui/icons-material/Add';
import AlertCircleIcon from '@mui/icons-material/ErrorOutline';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckIcon from '@mui/icons-material/Check';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DatabaseIcon from '@mui/icons-material/Storage';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import EyeIcon from '@mui/icons-material/Visibility';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RobotIcon from '@mui/icons-material/SmartToy';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import SortAscIcon from '@mui/icons-material/North';
import SortDescIcon from '@mui/icons-material/South';
import UserIcon from '@mui/icons-material/Person';
import UserPlusIcon from '@mui/icons-material/PersonAdd';
import UsersIcon from '@mui/icons-material/Groups';
import UserStarIcon from '@mui/icons-material/ManageAccounts';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import XIcon from '@mui/icons-material/Close';
import type { SvgIconProps } from '@mui/material';

type IconProps = Omit<SvgIconProps, 'color' | 'stroke'> & { size?: number | string; color?: string; stroke?: number | string };

function wrap(Icon: typeof AddIcon) {
  return function WrappedIcon({ size, color, sx, stroke: _stroke, ...props }: IconProps) {
    const isMuiColor = color && ['inherit', 'primary', 'secondary', 'action', 'disabled', 'error', 'info', 'success', 'warning'].includes(color);
    return <Icon fontSize={typeof size === 'number' && size <= 18 ? 'small' : undefined} color={isMuiColor ? (color as SvgIconProps['color']) : undefined} sx={{ ...(size ? { fontSize: size } : {}), ...(!isMuiColor && color ? { color } : {}), ...(sx as object) }} {...props} />;
  };
}

export const IconAlertCircle = wrap(AlertCircleIcon);
export const IconArrowDownRight = wrap(ArrowDownwardIcon);
export const IconArrowUpRight = wrap(ArrowUpwardIcon);
export const IconBrain = wrap(PsychologyIcon);
export const IconCheck = wrap(CheckIcon);
export const IconColumns = wrap(ViewColumnIcon);
export const IconDashboard = wrap(DashboardIcon);
export const IconDatabase = wrap(DatabaseIcon);
export const IconEdit = wrap(EditIcon);
export const IconEye = wrap(EyeIcon);
export const IconLogout = wrap(XIcon);
export const IconMenu2 = wrap(MenuIcon);
export const IconMenuDeep = wrap(MenuOpenIcon);
export const IconPlus = wrap(AddIcon);
export const IconRobot = wrap(RobotIcon);
export const IconSearch = wrap(SearchIcon);
export const IconSettings = wrap(SettingsIcon);
export const IconSortAscending = wrap(SortAscIcon);
export const IconSortDescending = wrap(SortDescIcon);
export const IconTrash = wrap(DeleteIcon);
export const IconUser = wrap(UserIcon);
export const IconUserPlus = wrap(UserPlusIcon);
export const IconUsers = wrap(UsersIcon);
export const IconUserStar = wrap(UserStarIcon);
export const IconVector = wrap(PsychologyIcon);
export const IconX = wrap(XIcon);
