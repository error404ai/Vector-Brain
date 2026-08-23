import {
  useGetAndroidDevicesQuery,
  useRequestPairingCodeMutation,
  useSendDirectActionMutation,
  useUnpairDeviceMutation,
} from '@/RTKService/androidService/androidService';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import QrCodeIcon from '@mui/icons-material/QrCode';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import {
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export function AndroidDevicesPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useGetAndroidDevicesQuery();
  const devices = data?.data || [];

  const [requestPairing, { isLoading: isPairingLoading }] = useRequestPairingCodeMutation();
  const [unpairDevice] = useUnpairDeviceMutation();
  const [sendDirectAction, { isLoading: isActionLoading }] = useSendDirectActionMutation();

  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState('My Android Phone');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [actionType, setActionType] = useState('HOME');
  const [packageNameInput, setPackageNameInput] = useState('com.google.android.youtube');

  const handleGeneratePairingCode = async () => {
    try {
      const res = await requestPairing({ device_name: deviceNameInput }).unwrap();
      setGeneratedCode(res.data.pairingCode);
      toast.success('Pairing code generated');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to generate code');
    }
  };

  const handleUnpair = async (id: number, name: string) => {
    if (confirm(`Are you sure you want to unpair "${name}"?`)) {
      try {
        await unpairDevice(id).unwrap();
        toast.success('Device removed');
      } catch (err: any) {
        toast.error(err?.data?.message || 'Failed to unpair');
      }
    }
  };

  const handleExecuteDirectAction = async () => {
    if (!selectedDevice) return;
    try {
      let actionPayload: any = { type: 'Global', action: actionType };
      if (actionType === 'OpenApp') {
        actionPayload = { type: 'OpenApp', packageName: packageNameInput };
      } else if (actionType === 'CaptureScreen') {
        actionPayload = { type: 'CaptureScreen' };
      } else if (actionType === 'ReadUiTree') {
        actionPayload = { type: 'ReadUiTree' };
      }

      const res = await sendDirectAction({ device_id: selectedDevice, action: actionPayload }).unwrap();
      toast.success(res.message || 'Action executed successfully');
      setActionModalOpen(false);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to execute action');
    }
  };

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', p: { xs: 1, sm: 2 } }}>
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={800} color="text.primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PhoneAndroidIcon color="primary" />
            Android Automation Devices
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage companion Android devices running native Accessibility & Screen Capture services.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => refetch()} sx={{ borderRadius: 2 }}>
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setGeneratedCode(null);
              setPairingModalOpen(true);
            }}
            sx={{
              borderRadius: 2,
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              fontWeight: 700,
            }}
          >
            Pair New Device
          </Button>
        </Stack>
      </Stack>

      {/* Device List */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : devices.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
          <PhoneAndroidIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" fontWeight={700}>
            No Android Devices Paired
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 1, mb: 3 }}>
            Pair your physical Android device or emulator with the Android Automation companion app to start running remote autonomous tasks.
          </Typography>
          <Button variant="contained" startIcon={<QrCodeIcon />} onClick={() => setPairingModalOpen(true)} sx={{ borderRadius: 2 }}>
            Pair Device Now
          </Button>
        </Card>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 2.5,
          }}
        >
          {devices.map((device) => {
            const isOnline = device.status === 'ONLINE';
            const isBusy = device.status === 'BUSY';

            return (
              <Card
                key={device.id}
                sx={{
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: isOnline ? alpha(theme.palette.success.main, 0.3) : 'divider',
                  boxShadow: isOnline ? `0 4px 20px ${alpha(theme.palette.success.main, 0.08)}` : 'none',
                  transition: 'all 0.2s',
                  '&:hover': { transform: 'translateY(-2px)' },
                }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: 2.5,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: isOnline ? alpha(theme.palette.success.main, 0.1) : alpha(theme.palette.grey[500], 0.1),
                          color: isOnline ? 'success.main' : 'text.secondary',
                        }}
                      >
                        <PhoneAndroidIcon />
                      </Box>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={800} noWrap sx={{ maxWidth: 160 }}>
                          {device.device_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {device.device_model || 'Android Device'} • {device.android_version || 'Android'}
                        </Typography>
                      </Box>
                    </Stack>

                    <Chip
                      label={device.status}
                      size="small"
                      color={isOnline ? 'success' : isBusy ? 'warning' : 'default'}
                      variant={isOnline ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 800, fontSize: 11 }}
                    />
                  </Stack>

                  <Divider sx={{ my: 2 }} />

                  <Stack spacing={1} sx={{ mb: 2.5 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        Accessibility Engine
                      </Typography>
                      <Typography variant="caption" fontWeight={700} color={device.capabilities?.accessibility ? 'success.main' : 'error.main'}>
                        {device.capabilities?.accessibility ? 'Enabled' : 'Disabled'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        Screen Capture
                      </Typography>
                      <Typography variant="caption" fontWeight={700} color={device.capabilities?.screenCapture ? 'success.main' : 'text.disabled'}>
                        {device.capabilities?.screenCapture ? 'Active' : 'Idle'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        Last Seen
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {device.last_seen_at ? new Date(device.last_seen_at).toLocaleTimeString() : 'Never'}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1}>
                    <Button
                      fullWidth
                      variant="contained"
                      size="small"
                      startIcon={<SmartToyIcon />}
                      disabled={!isOnline}
                      onClick={() => navigate(`/android-agent?deviceId=${device.id}`)}
                      sx={{ borderRadius: 2, fontWeight: 700 }}
                    >
                      AI Console
                    </Button>

                    <Tooltip title="Test Manual Action">
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={!isOnline}
                          onClick={() => {
                            setSelectedDevice(device.id);
                            setActionModalOpen(true);
                          }}
                          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip title="Unpair Device">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleUnpair(device.id, device.device_name)}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Pairing Modal */}
      <Dialog open={pairingModalOpen} onClose={() => setPairingModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle fontWeight={800}>Pair Android Device</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Open the <strong>Android Automation</strong> companion app on your phone or emulator and enter this 6-digit code.
          </Typography>

          {!generatedCode ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Device Nickname"
                value={deviceNameInput}
                onChange={(e) => setDeviceNameInput(e.target.value)}
                fullWidth
                size="small"
              />
              <Button
                variant="contained"
                onClick={handleGeneratePairingCode}
                disabled={isPairingLoading}
                startIcon={isPairingLoading ? <CircularProgress size={16} /> : <QrCodeIcon />}
                fullWidth
              >
                Generate Pairing Code
              </Button>
            </Stack>
          ) : (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                Enter This Pairing Code In App
              </Typography>
              <Box
                sx={{
                  mt: 1,
                  mb: 2,
                  py: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  borderRadius: 3,
                  border: '2px dashed',
                  borderColor: 'primary.main',
                }}
              >
                <Typography variant="h3" fontWeight={900} letterSpacing={6} color="primary.main">
                  {generatedCode}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Expires in 10 minutes. Once entered on the device, status will become <strong>ONLINE</strong>.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPairingModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Manual Direct Action Modal */}
      <Dialog open={actionModalOpen} onClose={() => setActionModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle fontWeight={800}>Test Direct Action</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Select size="small" value={actionType} onChange={(e) => setActionType(e.target.value)} fullWidth>
              <MenuItem value="HOME">Global: Press Home</MenuItem>
              <MenuItem value="BACK">Global: Press Back</MenuItem>
              <MenuItem value="RECENTS">Global: App Switcher / Recents</MenuItem>
              <MenuItem value="OpenApp">Open App (Package Name)</MenuItem>
              <MenuItem value="ReadUiTree">Read Accessibility UI Tree</MenuItem>
              <MenuItem value="CaptureScreen">Capture Screen Frame</MenuItem>
            </Select>

            {actionType === 'OpenApp' && (
              <TextField
                label="Package Name"
                value={packageNameInput}
                onChange={(e) => setPackageNameInput(e.target.value)}
                placeholder="com.android.settings"
                size="small"
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActionModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleExecuteDirectAction} disabled={isActionLoading} startIcon={<SendIcon />}>
            Execute
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AndroidDevicesPage;
